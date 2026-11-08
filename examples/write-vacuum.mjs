// 验证中文补丁：中文路径 + 中文注释，写 VacuumCtrl 到工程
// 注意：这是历史示例。工程路径从环境变量 INOPROSHOP_PROJECT 读，profile 自动探测。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfile } from './lib-profile.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.INOPROSHOP_EXE
  || 'C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe';
const PROFILE = resolveProfile(EXE);
const PROJECT = process.env.INOPROSHOP_PROJECT;
if (!PROJECT) {
  console.error('缺少 INOPROSHOP_PROJECT —— 请指到一个真实存在的工程文件，例如:');
  console.error('  set INOPROSHOP_PROJECT=C:\\path\\to\\my.project');
  process.exit(2);
}

const declaration = `PROGRAM VacuumCtrl
VAR
    xPick      : BOOL;   // 吸取命令
    xRelease   : BOOL;   // 释放命令
    xVacSensor : BOOL;   // 真空到位传感器
    xVacValve  : BOOL;   // 真空阀
    xBlowValve : BOOL;   // 破真空阀
    xDone      : BOOL;   // 动作完成（保持中）
    xAlarm     : BOOL;   // 报警（真空超时/吸力丢失）
    tVacTimer  : TON;    // 真空建立超时
    tBlowTimer : TON;    // 破真空延时
    iStep      : INT := 0;
END_VAR`;

const implementation = `tVacTimer(IN := xVacValve, PT := T#3S);
tBlowTimer(IN := xBlowValve, PT := T#1S);

CASE iStep OF
    0: // 待机：等待吸取命令
        xVacValve := FALSE;
        xBlowValve := FALSE;
        xDone := FALSE;
        xAlarm := FALSE;
        IF xPick THEN
            xVacValve := TRUE;
            iStep := 10;
        END_IF

    10: // 建立真空
        IF xVacSensor THEN
            xDone := TRUE;
            iStep := 20;
        ELSIF tVacTimer.Q THEN
            xVacValve := FALSE;
            xAlarm := TRUE;
            iStep := 30;
        END_IF

    20: // 真空保持：等待释放命令
        IF xRelease THEN
            xVacValve := FALSE;
            xBlowValve := TRUE;
            xDone := FALSE;
            iStep := 40;
        ELSIF NOT xVacSensor THEN
            xVacValve := FALSE;
            xAlarm := TRUE;
            iStep := 30;
        END_IF

    30: // 报警：等待复位
        IF NOT xPick AND NOT xRelease THEN
            xAlarm := FALSE;
            iStep := 0;
        END_IF

    40: // 破真空
        IF tBlowTimer.Q THEN
            xBlowValve := FALSE;
            xDone := TRUE;
            iStep := 0;
        END_IF
END_CASE`;

const child = spawn('node', [
  'dist/bin.js',
  '--codesys-path', EXE,
  '--codesys-profile', PROFILE,
  '--mode', 'persistent',
], { cwd: PKG });

let nextId = 1;
const pending = new Map();
let buf = '';
let initialized = false;

function call(name, args) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve, name });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } }) + '\n');
  });
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 0 && !initialized) {
      initialized = true;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      run();
      return;
    }
    if (pending.has(msg.id)) {
      const { resolve, name } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve({ name, msg });
    }
  }
});

let stderrBuf = '';
child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
child.on('error', (e) => { console.error('spawn 失败:', e.message); process.exit(1); });

function textOf(msg) {
  const c = msg?.result?.content || [];
  return c.map((p) => (p.type === 'text' ? p.text : JSON.stringify(p))).join('\n');
}

async function run() {
  const steps = [
    ['get_codesys_status', {}],
    ['open_project', { filePath: PROJECT }],
    ['get_project_structure', { projectFilePath: PROJECT }],
    ['create_pou', { projectFilePath: PROJECT, name: 'VacuumCtrl', type: 'Program', language: 'ST', parentPath: 'Application' }],
    ['set_pou_code', { projectFilePath: PROJECT, pouPath: 'Application/VacuumCtrl', declarationCode: declaration, implementationCode: implementation }],
    ['compile_project', { projectFilePath: PROJECT }],
  ];
  for (const [name, args] of steps) {
    const t0 = Date.now();
    const { msg } = await call(name, args);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n===== ${name} (${dt}s) =====`);
    console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
    const body = textOf(msg);
    console.log(body.length > 2000 ? body.slice(0, 2000) + '\n...[截断]' : body);
  }
  console.log('\n===== stderr 尾部 =====');
  console.log(stderrBuf.split('\n').filter((l) => /LAUNCHER|SERVER|Adopt|adopt|ready|spawn|Unicode|Error/i.test(l)).slice(-20).join('\n'));
  console.log('\nDONE');
  child.kill();
  process.exit(0);
}

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-vacuum', version: '1.0' } } }) + '\n');
setTimeout(() => { console.log('TIMEOUT'); console.log(stderrBuf.split('\n').slice(-40).join('\n')); child.kill(); process.exit(2); }, 360000);
