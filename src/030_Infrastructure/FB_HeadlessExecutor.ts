/**
 * FB_HeadlessExecutor - 无头执行器（西门子命名规范：FB_ 前缀 = Function Block，有状态实例）
 *
 * Runs each command as a standalone powershell.exe process:
 *   headless_bootstrap + helper functions + command script -> temp .ps1
 * The bootstrap loads Siemens.Engineering.dll and preloads shared helpers;
 * portal attach happens per-run (Ensure-Portal from ensure_project_open).
 *
 * 层级：030_Infrastructure（基础设施层：与 watcher 进程/文件系统交互）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { LauncherConfig, IpcResult, ScriptExecutor } from '../010_Core/T_Types';
import { headlessLog } from '../010_Core/FC_Logger';
import {
  G_SCRIPT_SUCCESS_MARKER,
  G_SCRIPT_ERROR_MARKER,
  G_HEADLESS_DEFAULT_TIMEOUT_MS,
} from '../020_Config/G_Config';
import { ScriptManager } from '../040_Services/FB_ScriptManager';

export class HeadlessExecutor implements ScriptExecutor {
  private config: LauncherConfig;

  constructor(config: LauncherConfig) {
    this.config = config;
    // TIA exe path is optional (the watcher/Openness can start TIA itself);
    // a missing path is not fatal in headless mode.
    if (config.tiaExePath && !fs.existsSync(config.tiaExePath)) {
      headlessLog.warn(`TIA Portal executable not found: ${config.tiaExePath} (continuing — Openness may still start it)`);
    }
  }

  /** Execute a script by spawning powershell.exe with the composed script */
  async executeScript(
    scriptContent: string,
    timeoutMs?: number
  ): Promise<IpcResult> {
    const timeout = timeoutMs ?? G_HEADLESS_DEFAULT_TIMEOUT_MS;
    const tempDir = os.tmpdir();
    const tempFileName = `tia_script_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}.ps1`;
    const tempFilePath = path.join(tempDir, tempFileName);

    const requestId = `headless_${Date.now()}`;

    try {
      // Compose: bootstrap (Openness dll + helpers preload) + command script
      const scriptManager = new ScriptManager();
      const bootstrap = scriptManager.prepareScript('headless_bootstrap', {
        PUBLIC_API_DLL: '', // empty -> bootstrap auto-detects
        SCRIPTS_DIR: path.join(__dirname, '..', '090_Scripts'),
      });
      const normalized = `${bootstrap}\n\n${scriptContent}`.replace(/\r\n/g, '\n');
      fs.writeFileSync(tempFilePath, normalized, 'utf-8');
      headlessLog.debug(`Temp script written: ${tempFilePath}`);

      const psArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', tempFilePath,
      ];
      headlessLog.debug(`Spawning: powershell.exe ${psArgs.join(' ')}`);

      // Spawn and collect output
      const result = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
        error?: Error;
      }>((resolve) => {
        let stdoutData = '';
        let stderrData = '';
        const controller = new AbortController();

        const child = spawn('powershell.exe', psArgs, {
          windowsHide: true,
          signal: controller.signal,
          cwd: tempDir,
          shell: false,
        });

        const timeoutId = setTimeout(() => {
          headlessLog.warn('Process timeout reached');
          controller.abort();
        }, timeout);

        child.stdout.on('data', (data: Buffer) => {
          stdoutData += data.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
          stderrData += data.toString();
        });

        child.on('error', (err: Error) => {
          clearTimeout(timeoutId);
          resolve({ code: 1, stdout: stdoutData, stderr: stderrData, error: err });
        });

        child.on('close', (code: number | null) => {
          clearTimeout(timeoutId);
          resolve({ code, stdout: stdoutData, stderr: stderrData });
        });

        controller.signal.addEventListener(
          'abort',
          () => {
            if (!child.killed) {
              child.kill('SIGTERM');
              setTimeout(() => {
                if (!child.killed) child.kill('SIGKILL');
              }, 2_000);
            }
            resolve({
              code: null,
              stdout: stdoutData,
              stderr: stderrData + '\nTIMEOUT: Process aborted.',
            });
          },
          { once: true }
        );
      });

      // Determine success (same marker protocol as the persistent watcher)
      let success = false;
      const combinedOutput = result.stdout;
      const stderrOutput = result.stderr;

      if (result.error) {
        success = false;
      } else if (
        combinedOutput.includes(G_SCRIPT_SUCCESS_MARKER) ||
        stderrOutput.includes(G_SCRIPT_SUCCESS_MARKER)
      ) {
        success = true;
      } else if (
        combinedOutput.includes(G_SCRIPT_ERROR_MARKER) ||
        stderrOutput.includes(G_SCRIPT_ERROR_MARKER)
      ) {
        success = false;
      } else {
        success = result.code === 0;
      }

      const finalOutput = success
        ? combinedOutput
        : `${stderrOutput}\n${combinedOutput}`.trim();

      return {
        requestId,
        success,
        output: finalOutput,
        error: success ? '' : (result.error?.message || stderrOutput || `Exit code ${result.code}`),
        timestamp: Date.now(),
      };
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        headlessLog.debug(`Failed to delete temp file: ${tempFilePath}`);
      }
    }
  }
}
