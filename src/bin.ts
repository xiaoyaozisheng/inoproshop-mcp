#!/usr/bin/env node
/**
 * CLI entry point for tia-portal-mcp.
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { startMcpServer } from './050_Server/Server';
import { ServerConfig, ExecutionMode } from './010_Core/T_Types';

let version = '0.1.0';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../package.json');
  version = pkg.version;
} catch {
  // ignore
}

/**
 * Locate the TIA Portal executable in a Portal installation directory:
 *   <root>/Bin/Siemens.Automation.Portal.exe
 */
function findTiaExe(portalRoot: string): string {
  const exe = path.join(portalRoot, 'Bin', 'Siemens.Automation.Portal.exe');
  return fs.existsSync(exe) ? exe : '';
}

program
  .name('tia-portal-mcp')
  .description('MCP server for Siemens TIA Portal with persistent Openness watcher')
  .version(version)
  .option(
    '-p, --tia-exe <path>',
    'Path to the TIA Portal executable (Siemens.Automation.Portal.exe). Optional: the watcher attaches to a running TIA Portal, or starts one via Openness.',
    process.env.TIA_MCP_EXE || ''
  )
  .option(
    '-v, --tia-version <version>',
    'TIA Portal version hint used to pick the Openness PublicAPI dll (e.g. "V17"). Auto-detects the newest when omitted.',
    process.env.TIA_MCP_VERSION || ''
  )
  .option(
    '-w, --workspace <dir>',
    'Workspace directory for relative project paths',
    process.cwd()
  )
  .option(
    '-m, --mode <mode>',
    'Execution mode: persistent (watcher process) or headless (powershell per command)',
    'persistent'
  )
  .option('--no-auto-launch', 'Do not auto-start the watcher on startup')
  .option('--fallback-headless', 'Fall back to headless if persistent fails', true)
  .option('--keep-alive', 'Keep the watcher running after server stops', false)
  .option('--kill-existing-tia', 'Kill any running TIA Portal before launching (dev convenience; off by default)', false)
  .option('--timeout <ms>', 'Default command timeout in ms', '60000')
  .option('--verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (more verbose)')
  .option('--allow-eval', 'Register the eval_powershell tool (arbitrary PowerShell execution; dev only, off by default)', false)
  .option('--detect', 'Detect installed TIA Portal versions and exit')
  .parse(process.argv);

const opts = program.opts();

// Handle --detect flag
if (opts.detect) {
  const automationRoot = 'C:\\Program Files\\Siemens\\Automation';
  process.stderr.write('Scanning for TIA Portal installations...\n\n');
  let found = 0;
  if (fs.existsSync(automationRoot)) {
    for (const entry of fs.readdirSync(automationRoot).sort()) {
      if (!/^Portal V/i.test(entry)) continue;
      const portalRoot = path.join(automationRoot, entry);
      const exe = findTiaExe(portalRoot);
      // PublicAPI dll probe
      let dll = '';
      const publicApiRoot = path.join(portalRoot, 'PublicAPI');
      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.name === 'Siemens.Engineering.dll' && !dll) dll = full;
        }
      };
      if (fs.existsSync(publicApiRoot)) walk(publicApiRoot);
      const ok = exe ? '[OK]' : '[--]';
      process.stderr.write(`  ${ok} ${portalRoot}\n`);
      if (exe) {
        process.stderr.write(`        Exe: ${exe}\n`);
        found++;
      }
      if (dll) {
        process.stderr.write(`        Openness dll: ${dll}\n`);
      }
    }
  } else {
    process.stderr.write(`  (no Siemens\\Automation directory at ${automationRoot})\n`);
  }
  process.stderr.write(`\nFound ${found} TIA Portal installation(s).\n`);
  process.exit(0);
} else {
  // Build server config
  const config: ServerConfig = {
    tiaExePath: (opts.tiaExe || '').trim(),
    tiaVersion: (opts.tiaVersion || '').trim(),
    workspaceDir: opts.workspace.trim(),
    autoLaunch: opts.autoLaunch !== false,
    keepAlive: opts.keepAlive || false,
    killExistingTia: opts.killExistingTia || false,
    timeoutMs: parseInt(opts.timeout, 10) || 60000,
    fallbackHeadless: opts.fallbackHeadless !== false,
    verbose: opts.verbose || false,
    debug: opts.debug || false,
    allowEval: opts.allowEval || false,
    mode: (opts.mode === 'headless' ? 'headless' : 'persistent') as ExecutionMode,
  };

  process.stderr.write(`Starting TIA Portal MCP Server v${version}\n`);
  process.stderr.write(`  TIA Portal exe: ${config.tiaExePath || '(auto)'}\n`);
  process.stderr.write(`  TIA version hint: ${config.tiaVersion || '(auto-detect)'}\n`);
  process.stderr.write(`  Mode: ${config.mode}\n`);
  process.stderr.write(`  Auto-launch: ${config.autoLaunch}\n`);

  startMcpServer(config).catch((err) => {
    process.stderr.write(`FATAL: ${err.message}\n`);
    process.exit(1);
  });
}
