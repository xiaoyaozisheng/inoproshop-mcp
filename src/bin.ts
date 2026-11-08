#!/usr/bin/env node
/**
 * CLI entry point for codesys-mcp-persistent.
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { startMcpServer } from './server';
import { ServerConfig, ExecutionMode } from './types';

let version = '0.1.0';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../package.json');
  version = pkg.version;
} catch {
  // ignore
}

/**
 * CODESYS keeps its profiles in <install>/CODESYS/Profiles/<name>.profile.
 * With the exe at <install>/CODESYS/Common/<IDE>.exe that resolves by walking
 * up from the exe directory.
 */
function resolveProfilesDir(codesysPath: string): string {
  const commonDir = path.dirname(codesysPath);
  return path.join(path.dirname(commonDir), 'Profiles');
}

/**
 * Fail fast on a bad --codesys-profile.
 *
 * A wrong profile name does not produce an obvious error: CODESYS either
 * refuses to start or starts under a different profile, and the MCP server
 * then sits waiting for a ready.signal that never appears - which reads as a
 * mysterious hang. Profile names are machine/IDE-specific (e.g.
 * "InoProShop(V1.10.0.3)" on one install, "InoProShop(V1.9.0.1)" on another),
 * so a name copied out of a README is very often wrong. List what is actually
 * installed instead of guessing.
 */
function assertProfileExists(codesysPath: string, profileName: string): void {
  const profilesDir = resolveProfilesDir(codesysPath);
  if (!fs.existsSync(profilesDir)) return; // unusual layout - do not block
  let available: string[] = [];
  try {
    available = fs
      .readdirSync(profilesDir)
      .filter((f) => f.toLowerCase().endsWith('.profile'))
      .map((f) => f.replace(/\.profile$/i, ''));
  } catch {
    return; // unreadable - do not block
  }
  if (available.length === 0) return;
  if (available.indexOf(profileName) !== -1) return;
  process.stderr.write(
    `\n[FATAL] CODESYS profile '${profileName}' does not exist on this machine.\n` +
      `        Looked in : ${profilesDir}\n` +
      `        Available : ${available.map((a) => `'${a}'`).join(', ')}\n` +
      `        Fix       : pass the correct name with --codesys-profile "<name>".\n` +
      `        Note      : profile names differ between machines and IDE builds -\n` +
      `                    never copy one from a README or an example file.\n\n`
  );
  process.exit(2);
}

program
  .name('codesys-mcp-persistent')
  .description('MCP server for CODESYS with persistent UI instance')
  .version(version)
  .option(
    '-p, --codesys-path <path>',
    'Path to CODESYS executable',
    process.env.CODESYS_PATH || 'C:\\Program Files\\CODESYS 3.5.21.0\\CODESYS\\Common\\CODESYS.exe'
  )
  .option(
    '-f, --codesys-profile <profile>',
    'CODESYS profile name',
    process.env.CODESYS_PROFILE || 'CODESYS V3.5 SP21'
  )
  .option(
    '-w, --workspace <dir>',
    'Workspace directory for relative project paths',
    process.cwd()
  )
  .option(
    '-m, --mode <mode>',
    'Execution mode: persistent (UI) or headless (--noUI)',
    'persistent'
  )
  .option('--no-auto-launch', 'Do not auto-launch CODESYS on startup')
  .option('--fallback-headless', 'Fall back to headless if persistent fails', true)
  .option('--keep-alive', 'Keep CODESYS running after server stops', false)
  .option('--kill-existing-codesys', 'Kill any running CODESYS.exe before launching (dev convenience; off by default)', false)
  .option('--timeout <ms>', 'Default command timeout in ms', '60000')
  .option('--verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (more verbose)')
  .option('--allow-eval', 'Register the eval_python tool (arbitrary IronPython execution; dev only, off by default)', false)
  .option('--detect', 'Detect installed CODESYS versions and exit')
  .parse(process.argv);

const opts = program.opts();

// Handle --detect flag
if (opts.detect) {
  import('fs').then((fs) => {
    import('path').then((pathMod) => {
      const dirs = [
        'C:\\Program Files',
        'C:\\Program Files (x86)',
      ];
      process.stderr.write('Scanning for CODESYS installations...\n\n');
      let found = 0;
      for (const base of dirs) {
        try {
          const entries = fs.readdirSync(base);
          for (const entry of entries) {
            if (entry.toLowerCase().includes('codesys')) {
              const commonExe = pathMod.join(base, entry, 'CODESYS', 'Common', 'CODESYS.exe');
              const exists = fs.existsSync(commonExe);
              process.stderr.write(`  ${exists ? '[OK]' : '[--]'} ${pathMod.join(base, entry)}\n`);
              if (exists) {
                process.stderr.write(`        Exe: ${commonExe}\n`);
                found++;
              }
            }
          }
        } catch {
          // dir doesn't exist
        }
      }
      process.stderr.write(`\nFound ${found} CODESYS installation(s).\n`);
      process.exit(0);
    });
  });
} else {
  // Build server config
  const config: ServerConfig = {
    codesysPath: opts.codesysPath.trim(),
    profileName: opts.codesysProfile.trim(),
    workspaceDir: opts.workspace.trim(),
    autoLaunch: opts.autoLaunch !== false,
    keepAlive: opts.keepAlive || false,
    killExistingCodesys: opts.killExistingCodesys || false,
    timeoutMs: parseInt(opts.timeout, 10) || 60000,
    fallbackHeadless: opts.fallbackHeadless !== false,
    verbose: opts.verbose || false,
    debug: opts.debug || false,
    allowEval: opts.allowEval || false,
    mode: (opts.mode === 'headless' ? 'headless' : 'persistent') as ExecutionMode,
  };

  // Refuse to run with a profile that is not installed: a mismatch shows up
  // as an unexplained hang waiting for ready.signal, which is far harder to
  // diagnose than an explicit error here.
  assertProfileExists(config.codesysPath, config.profileName);

  process.stderr.write(`Starting CODESYS MCP Server v${version}\n`);
  process.stderr.write(`  CODESYS Path: ${config.codesysPath}\n`);
  process.stderr.write(`  Profile: ${config.profileName}\n`);
  process.stderr.write(`  Mode: ${config.mode}\n`);
  process.stderr.write(`  Auto-launch: ${config.autoLaunch}\n`);

  startMcpServer(config).catch((err) => {
    process.stderr.write(`FATAL: ${err.message}\n`);
    process.exit(1);
  });
}
