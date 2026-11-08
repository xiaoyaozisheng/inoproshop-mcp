// 测试 luke-harriman/Codesys-MCP 对 InoProShop 的持久化读写
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
  const steps = [];

  steps.push(['tools/list', {}]);
  steps.push(['get_codesys_status', {}]);
  steps.push(['open_project', { filePath: PROJECT }]);
  steps.push(['create_pou', { projectFilePath: PROJECT, name: 'LukeTest', type: 'Program', language: 'ST', parentPath: 'Application' }]);
  steps.push(['set_pou_code', {
    projectFilePath: PROJECT,
    pouPath: 'Application/LukeTest',
    declarationCode: 'PROGRAM LukeTest\nVAR\n    iCount : INT;\n    bRun   : BOOL;\nEND_VAR',
    implementationCode: 'iCount := iCount + 1;\nIF iCount >= 100 THEN\n    iCount := 0;\n    bRun := NOT bRun;\nEND_IF',
  }]);
  steps.push(['compile_project', { projectFilePath: PROJECT }]);

  for (const [name, args] of steps) {
    const t0 = Date.now();
    const { msg } = await call(name, args);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n===== ${name} (${dt}s) =====`);
    const body = textOf(msg);
    console.log(msg?.result?.isError ? '(isError=true)' : '(ok)');
    console.log(body.length > 2000 ? body.slice(0, 2000) + '\n...[截断]' : body);
  }

  console.log('\n===== 服务器 stderr 尾部 =====');
  console.log(stderrBuf.split('\n').slice(-30).join('\n'));
  console.log('\nDONE');
  child.kill();
  process.exit(0);
}

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'luke-test', version: '1.0' } } }) + '\n');
setTimeout(() => { console.log('TIMEOUT'); console.log(stderrBuf.split('\n').slice(-40).join('\n')); child.kill(); process.exit(2); }, 300000);
