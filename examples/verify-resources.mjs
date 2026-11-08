// ============================================================================
// verify-resources.mjs —— MCP 资源(resource)路径验证
//
// 注意：get_project_structure / get_pou_code **不是 tool，是 resource**。
//       用 tools/call 调它们会报 `MCP error -32602: Tool ... not found`。
//       本脚本走的是正确的 resources/read，并同时验证两种 URI 写法：
//         - 路径原样            codesys://project/C:/.../项目/未命名1.project/structure
//         - 路径百分号编码      codesys://project/C%3A/.../%E9%A1%B9%E7%9B%AE/.../structure
//       0.7.0 起两种都支持（server.ts 的 decodeUriPath 会解码）。
//
// 跑法：
//   set INOPROSHOP_PROJECT=C:\path\to\your.project
//   node examples/verify-resources.mjs
//
// 可选环境变量：
//   INOPROSHOP_PROJECT  必填，工程文件路径
//   INOPROSHOP_POU      可选，要读代码的 POU 路径（默认 Application/PLC_PRG）
//   INOPROSHOP_EXE      可选
//   INOPROSHOP_PROFILE  可选（务必与 …/CODESYS/Profiles 下的实际值一致）
//
// 本脚本**只读**，不修改工程。若 InoProShop 已在运行，它应当被自动接管
// （stderr 会出现 "Adopting existing session"），而不会重复拉起。
// ============================================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfile } from './lib-profile.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROJECT = process.env.INOPROSHOP_PROJECT;
const POU = process.env.INOPROSHOP_POU || 'Application/PLC_PRG';
const EXE = process.env.INOPROSHOP_EXE
  || 'C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe';
const PROFILE = resolveProfile(EXE);

if (!PROJECT) {
  console.error('缺少 INOPROSHOP_PROJECT —— 请指到一个真实存在的工程文件。');
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

function rpc(method, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
  });
}

const results = [];
function check(label, ok, extra) {
  results.push({ label, ok });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
}

const enc = (p) => encodeURI(p).replace(/#/g, '%23');
const bodyOf = (m) => String(m?.result?.contents?.[0]?.text ?? JSON.stringify(m?.error ?? m));

async function run() {
  console.log('===== MCP 资源路径验证 =====');
  console.log('包目录:', PKG);
  console.log('工程  :', PROJECT);
  console.log('POU   :', POU, '\n');

  // 0) 先确保工程已打开 —— 资源走的是 require_project_open，拒绝隐式切换工程
  process.stdout.write('--- open_project (tools/call) ... ');
  await rpc('tools/call', { name: 'open_project', arguments: { filePath: PROJECT } }, 180000);
  console.log('ok');

  // 1) 静态资源
  process.stdout.write('\n--- resources/list ... ');
  const lst = await rpc('resources/list');
  const uris = (lst?.result?.resources || []).map((r) => r.uri);
  console.log('ok');
  console.log('    已注册:', JSON.stringify(uris));
  check('resources/list 返回资源列表', uris.length > 0);

  process.stdout.write('\n--- read codesys://project/status ... ');
  const statusText = bodyOf(await rpc('resources/read', { uri: 'codesys://project/status' }));
  console.log('ok');
  console.log('    ' + statusText.replace(/\n/g, '\n    ').slice(0, 300));
  check('status 资源可读', statusText.includes('CODESYS Status'));
  check('status 显示工程已打开', /Project Open:\s*True/i.test(statusText));
  // 工程名/路径往往是中文，能原样回来说明中文链路是通的
  const baseName = PROJECT.replace(/\\/g, '/').split('/').pop();
  check(`status 里的工程名中文完好 (${baseName})`, statusText.includes(baseName));

  // 2) 模板资源：两种 URI 写法各测一遍
  for (const [style, build] of [['路径原样', (p) => p], ['路径百分号编码', enc]]) {
    console.log(`\n########## URI 写法：${style} ##########`);

    process.stdout.write('--- read 工程结构资源 ... ');
    const struct = bodyOf(await rpc('resources/read', {
      uri: `codesys://project/${build(PROJECT)}/structure`,
    }));
    console.log('ok');
    check(`[${style}] 工程结构资源可读`, struct.includes('Application'));
    check(`[${style}] 结构非空`, struct.length > 20, `${struct.length} 字符`);

    process.stdout.write('--- read POU 代码资源 ... ');
    const code = bodyOf(await rpc('resources/read', {
      uri: `codesys://project/${build(PROJECT)}/pou/${build(POU)}/code`,
    }));
    console.log('ok');
    check(`[${style}] POU 代码资源可读`, code.length > 20 && !/Error retrieving code/.test(code),
      `${code.length} 字符`);
    check(`[${style}] POU 代码无乱码`, !code.includes('ä¼¸') && !code.includes('Ã§Â¼Â©'));
    if (code.length <= 20 || /Error retrieving code/.test(code)) {
      console.log('    ' + code.replace(/\n/g, '\n    ').slice(0, 300));
    }
  }

  // 3) 实例接管
  const adopted = /Adopting existing session/i.test(stderrBuf);
  check('接管已运行实例（未重复拉起 InoProShop）', adopted);

  finish(results.every((r) => r.ok) ? 0 : 1);
}

function finish(code) {
  console.log('\n===== 汇总 =====');
  const bad = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - bad.length}/${results.length}`);
  bad.forEach((b) => console.log('  失败: ' + b.label));
  console.log('\n===== MCP stderr（关键行）=====');
  console.log(stderrBuf.split('\n')
    .filter((l) => /Adopt|adopt|ready|LAUNCHER|State:|ERROR|WARN/.test(l))
    .slice(-10).join('\n'));
  try { child.kill(); } catch { /* ignore */ }
  process.exit(code);
}

setTimeout(() => {
  console.log('\n!! 整体超时');
  console.log(stderrBuf.slice(-2000));
  try { child.kill(); } catch { /* ignore */ }
  process.exit(2);
}, 600000);

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-resources', version: '1.0' } },
}) + '\n');
