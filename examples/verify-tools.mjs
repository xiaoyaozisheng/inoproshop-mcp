// ============================================================================
// verify-tools.mjs —— MCP 工具链端到端验证（含中文回归断言）
//
// 跑法：
//   set INOPROSHOP_PROJECT=C:\path\to\your.project   (Windows)
//   export INOPROSHOP_PROJECT=/path/to/your.project  (bash)
//   node examples/verify-tools.mjs
//
// 它真的会启动 InoProShop 并向工程里**写入**一个测试 POU（默认名 MCPTest），
// 跑完自动删掉。请先确认工程已保存、且可以接受这个临时对象。
//
// 可选环境变量：
//   INOPROSHOP_PROJECT  必填，工程文件路径
//   INOPROSHOP_EXE      可选，InoProShop.exe 路径
//   INOPROSHOP_PROFILE  可选，profile 名（务必与 …/CODESYS/Profiles 下的实际值一致）
//   INOPROSHOP_TESTPOU  可选，测试 POU 名字（默认 MCPTest）
//
// 重点验证：**POU 里有中文注释时，get_all_pou_code 不再永久卡死、且不乱码**。
// 这是 0.7.0 修掉的那个 bug（watcher.py 用 json.dumps 默认 ensure_ascii=True，
// IronPython 2.7 会对已是 unicode 的字符串再 decode 一次，直接抛 UnicodeEncodeError）。
// ============================================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfile } from './lib-profile.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROJECT = process.env.INOPROSHOP_PROJECT;
const EXE = process.env.INOPROSHOP_EXE
  || 'C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe';
const PROFILE = resolveProfile(EXE);
const TESTPOU = process.env.INOPROSHOP_TESTPOU || 'MCPTest';

if (!PROJECT) {
  console.error('缺少 INOPROSHOP_PROJECT —— 请指到一个真实存在的工程文件。');
  console.error('例如:  set INOPROSHOP_PROJECT=C:\\Users\\me\\Desktop\\proj\\my.project');
  process.exit(2);
}

const child = spawn('node', [path.join(PKG, 'dist', 'bin.js'),
  '--codesys-path', EXE,
  '--codesys-profile', PROFILE,
  '--mode', 'persistent',
], { cwd: PKG, stdio: ['pipe', 'pipe', 'pipe'] });

let nextId = 1, buf = '', stderrBuf = '', initialized = false;
const pending = new Map();

child.stderr.on('data', (d) => { stderrBuf += d.toString('utf8'); });
child.on('error', (e) => { console.error('spawn 失败:', e.message); process.exit(1); });

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 0 && !initialized) {
      initialized = true;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      run().catch((e) => { console.error('run 异常:', e); finish(1); });
      return;
    }
    if (pending.has(msg.id)) { const r = pending.get(msg.id); pending.delete(msg.id); r(msg); }
  }
});

function call(name, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`工具 ${name} 超时 ${timeoutMs}ms —— 这正是修复前的故障表现`));
    }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} },
    }) + '\n');
  });
}

const textOf = (msg) => (msg?.result?.content || [])
  .map((p) => (p.type === 'text' ? p.text : JSON.stringify(p))).join('\n');

const results = [];
function check(label, ok, extra) {
  results.push({ label, ok });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
}

async function run() {
  console.log('===== MCP 工具链端到端验证 =====');
  console.log('包目录:', PKG);
  console.log('工程  :', PROJECT);
  console.log('profile:', PROFILE, '\n');

  const steps = [
    // 第一次调用会触发 InoProShop 冷启动，可能要 1~3 分钟
    ['get_codesys_status', {}, 300000],
    ['open_project', { filePath: PROJECT }, 180000],
    ['create_pou', { projectFilePath: PROJECT, name: TESTPOU, type: 'Program', language: 'ST', parentPath: 'Application' }, 120000],
    ['set_pou_code', {
      projectFilePath: PROJECT,
      pouPath: `Application/${TESTPOU}`,
      declarationCode: `PROGRAM ${TESTPOU}\nVAR\n    xStart  : BOOL;   // 启动按钮\n    xDone   : BOOL;   // 完成标志\nEND_VAR`,
      implementationCode: `// 中文注释回归测试：这行中文以前会让读回工具永久卡死\nIF xStart THEN\n    xDone := TRUE;   // 置位完成信号\nELSE\n    xDone := FALSE;\nEND_IF`,
    }, 120000],
    ['compile_project', { projectFilePath: PROJECT }, 300000],
    // ↓ 修复前 100% 卡死在这一步
    ['get_all_pou_code', { projectFilePath: PROJECT }, 180000],
    ['delete_object', { projectFilePath: PROJECT, objectPath: `Application/${TESTPOU}` }, 120000],
  ];

  const out = {};
  for (const [name, args, tmo] of steps) {
    const t0 = Date.now();
    process.stdout.write(`\n--- ${name} ... `);
    try {
      const msg = await call(name, args, tmo);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const body = textOf(msg);
      const isErr = msg?.result?.isError === true;
      console.log(`${dt}s  ${isErr ? 'isError=true' : 'ok'}`);
      out[name] = body;
      check(name, !isErr, `${dt}s`);
      if (isErr) console.log('     ' + body.slice(0, 400).replace(/\n/g, '\n     '));
    } catch (e) {
      console.log('抛出异常');
      check(name, false, e.message);
    }
  }

  console.log('\n===== 中文回归断言 =====');
  const all = out['get_all_pou_code'] || '';
  check("读回结果含测试 POU 的中文 '启动按钮'", all.includes('启动按钮'));
  check("读回结果含测试 POU 的中文 '置位完成信号'", all.includes('置位完成信号'));
  check('读回结果含测试 POU 名字', all.includes(TESTPOU));
  check('读回结果没有乱码（ä¼¸ / Ã§Â¼Â©）',
    !all.includes('ä¼¸') && !all.includes('Ã§Â¼Â©'));

  const adopted = /Adopting existing session/i.test(stderrBuf);
  console.log(`\n(实例接管: ${adopted ? '接管的既有实例' : '本次新启动/或已在运行'})`);

  finish(results.every((r) => r.ok) ? 0 : 1);
}

function finish(code) {
  console.log('\n===== 汇总 =====');
  const bad = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - bad.length}/${results.length}`);
  bad.forEach((b) => console.log('  失败: ' + b.label));
  console.log('\n===== MCP server stderr 尾部 =====');
  console.log(stderrBuf.split('\n').filter((l) => l.trim()).slice(-15).join('\n'));
  try { child.kill(); } catch { /* ignore */ }
  process.exit(code);
}

setTimeout(() => {
  console.log('\n!! 整体超时');
  console.log(stderrBuf.split('\n').slice(-25).join('\n'));
  try { child.kill(); } catch { /* ignore */ }
  process.exit(2);
}, 900000);

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-tools', version: '1.0' } },
}) + '\n');
