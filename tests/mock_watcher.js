#!/usr/bin/env node
/**
 * mock_watcher.js - Test double for the TIA Portal watcher process.
 *
 * Implements the file-based IPC protocol without any IDE:
 *   commands/<id>.command.json  -> results/<id>.result.json
 *   ready.signal / terminate.signal
 *
 * Echo semantics (documented contract for tests):
 *   - output = the trimmed script content (echoed back)
 *   - success = false when the content contains SCRIPT_ERROR,
 *     otherwise true (SCRIPT_SUCCESS not required, matching the real
 *     watcher's "no exception and no SCRIPT_ERROR => success" rule)
 *
 * Usage: node mock_watcher.js --ipc-dir <dir>
 */

const fs = require('fs');
const path = require('path');

const argvIdx = process.argv.indexOf('--ipc-dir');
const ipcDir = argvIdx !== -1 ? process.argv[argvIdx + 1] : process.cwd();
const commandsDir = path.join(ipcDir, 'commands');
const resultsDir = path.join(ipcDir, 'results');
const readyPath = path.join(ipcDir, 'ready.signal');
const termPath = path.join(ipcDir, 'terminate.signal');

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function writeResult(requestId, result) {
  atomicWrite(path.join(resultsDir, `${requestId}.result.json`), JSON.stringify(result));
}

function processCommand(cmdFile) {
  const requestId = path.basename(cmdFile).replace('.command.json', '');
  const resultPath = path.join(resultsDir, `${requestId}.result.json`);
  let scriptPath = '';
  try {
    const data = JSON.parse(fs.readFileSync(cmdFile, 'utf-8'));
    scriptPath = data.scriptPath || '';
  } catch (err) {
    writeResult(requestId, { requestId, success: false, output: '', error: `Read error: ${err.message}`, timestamp: Date.now() / 1000 });
    return;
  }
  let code = '';
  try {
    code = fs.readFileSync(scriptPath, 'utf-8');
  } catch (err) {
    writeResult(requestId, { requestId, success: false, output: '', error: `Script file not found: ${scriptPath}`, timestamp: Date.now() / 1000 });
    fs.unlinkSync(cmdFile);
    return;
  }

  const output = code.trim();
  const success = !output.includes('SCRIPT_ERROR');
  writeResult(requestId, {
    requestId,
    success,
    output,
    error: success ? '' : 'Script reported error via SCRIPT_ERROR marker',
    timestamp: Date.now() / 1000,
  });

  try { fs.unlinkSync(cmdFile); } catch { }
  try { fs.unlinkSync(scriptPath); } catch { }
}

function main() {
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  atomicWrite(readyPath, JSON.stringify({
    version: 'mock', host_version: process.version, pid: process.pid,
    ipc_dir: ipcDir, timestamp: Date.now() / 1000,
  }));

  const poll = () => {
    if (fs.existsSync(termPath)) process.exit(0);
    let cmdFiles = [];
    try {
      cmdFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.command.json')).sort();
    } catch { }
    for (const f of cmdFiles) {
      try { processCommand(path.join(commandsDir, f)); } catch { }
    }
    setTimeout(poll, 25);
  };
  poll();
}

main();
