// 验证真空程序 + 写气缸封装 FB
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

const fbDeclaration = `FUNCTION_BLOCK Cylinder
VAR_INPUT
    xStart   : BOOL;   // 伸出命令
    xReturn  : BOOL;   // 缩回命令
    xExtPos  : BOOL;   // 伸出到位传感器
    xRetPos  : BOOL;   // 缩回到位传感器
    tTimeout : TIME := T#3S;  // 动作超时时间
END_VAR
VAR_OUTPUT
    xExtValve : BOOL;  // 伸出阀
    xRetValve : BOOL;  // 缩回阀
    xDone     : BOOL;  // 动作完成
    xAlarm    : BOOL;  // 超时报警
END_VAR
VAR
    tExtTimer : TON;   // 伸出超时计时器
    tRetTimer : TON;   // 缩回超时计时器
    iStep     : INT := 0;
END_VAR`;

const fbImplementation = `tExtTimer(IN := xExtValve, PT := tTimeout);
tRetTimer(IN := xRetValve, PT := tTimeout);

CASE iStep OF
    0: // 待机：等待伸出命令
        xExtValve := FALSE;
        xRetValve := FALSE;
        xDone := FALSE;
        xAlarm := FALSE;
        IF xStart THEN
            xExtValve := TRUE;
            iStep := 10;
        END_IF

    10: // 伸出中
        IF xExtPos THEN
            xExtValve := FALSE;
            xDone := TRUE;
            iStep := 20;
        ELSIF tExtTimer.Q THEN
            xExtValve := FALSE;
            xAlarm := TRUE;
            iStep := 30;
        END_IF

    20: // 伸出到位：等待缩回命令
        IF xReturn THEN
            xRetValve := TRUE;
            xDone := FALSE;
            iStep := 40;
        END_IF

    30: // 报警：等待复位
        IF NOT xStart THEN
            xAlarm := FALSE;
            iStep := 0;
        END_IF

    40: // 缩回中
        IF xRetPos THEN
            xRetValve := FALSE;
            xDone := TRUE;
            iStep := 0;
        ELSIF tRetTimer.Q THEN
            xRetValve := FALSE;
            xAlarm := TRUE;
            iStep := 30;
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
  // 1) 状态（接管 live 实例）
  let { msg } = await call('get_codesys_status', {});
  console.log('===== get_codesys_status =====\n' + textOf(msg).split('\n').slice(0, 3).join('\n'));

  // 2) 验证真空程序编译信息
  ({ msg } = await call('get_compile_messages', { projectFilePath: PROJECT }));
  console.log('\n===== get_compile_messages =====');
  console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
  let cm = textOf(msg);
  console.log(cm.length > 1200 ? cm.slice(0, 1200) + '\n...[截断]' : cm);

  // 3) 读回所有 POU，验证中文注释是否完整
  ({ msg } = await call('get_all_pou_code', { projectFilePath: PROJECT }));
  const all = textOf(msg);
  const hasVacuum = all.includes('真空阀') && all.includes('破真空阀');
  console.log('\n===== 中文注释校验 =====');
  console.log('VacuumCtrl 中文注释完整:', hasVacuum ? '是 ✅' : '否 ❌');
  const vacIdx = all.indexOf('VacuumCtrl');
  if (vacIdx >= 0) console.log('--- VacuumCtrl 片段 ---\n' + all.slice(vacIdx, vacIdx + 600));

  // 4) 创建气缸 FB
  ({ msg } = await call('create_pou', { projectFilePath: PROJECT, name: 'Cylinder', type: 'FunctionBlock', language: 'ST', parentPath: 'Application' }));
  console.log('\n===== create_pou Cylinder (FB) =====');
  console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
  console.log(textOf(msg).slice(0, 500));

  // 5) 写气缸 FB 代码
  const t0 = Date.now();
  ({ msg } = await call('set_pou_code', { projectFilePath: PROJECT, pouPath: 'Application/Cylinder', declarationCode: fbDeclaration, implementationCode: fbImplementation }));
  console.log('\n===== set_pou_code Cylinder (' + ((Date.now() - t0) / 1000).toFixed(1) + 's) =====');
  console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
  console.log(textOf(msg).slice(0, 500));

  // 6) 编译
  ({ msg } = await call('compile_project', { projectFilePath: PROJECT }));
  console.log('\n===== compile_project =====');
  console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
  console.log(textOf(msg).slice(0, 500));

  console.log('\nDONE');
  child.kill();
  process.exit(0);
}

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'write-cylinder-fb', version: '1.0' } } }) + '\n');
setTimeout(() => { console.log('TIMEOUT'); console.log(stderrBuf.split('\n').slice(-40).join('\n')); child.kill(); process.exit(2); }, 300000);
