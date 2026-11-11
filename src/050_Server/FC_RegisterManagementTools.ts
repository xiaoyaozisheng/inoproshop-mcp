/**
 * FC_RegisterManagementTools - 管理类工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 4 个管理工具：launch_tia / shutdown_tia / eval_powershell /
 * get_tia_status。对应原 server.ts "Management Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { HeadlessExecutor } from '../030_Infrastructure/FB_HeadlessExecutor';
import { G_EVAL_DEFAULT_TIMEOUT_MS } from '../020_Config/G_Config';

export function registerManagementTools(s: any, ctx: ToolContext): void {
  const { config, launcher, executor } = ctx;

  s.tool(
    'launch_tia',
    'Manually start the TIA Portal Openness watcher (attaches to a running TIA Portal, or lets Openness start one). Use when --no-auto-launch was set.',
    async () => {
      if (!launcher) {
        return {
          content: [{ type: 'text' as const, text: 'Persistent mode not configured. Use --mode persistent.' }],
          isError: true,
        };
      }
      try {
        await launcher.launch();
        executor.swapNow(launcher);
        ctx.executionMode = 'persistent';
        return {
          content: [{ type: 'text' as const, text: 'TIA Portal watcher launched successfully in persistent mode. First project command will attach to / start TIA Portal (the Openness firewall prompt must be accepted once in the TIA UI).' }],
          isError: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Launch failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  s.tool(
    'shutdown_tia',
    'Shut down the persistent TIA Portal watcher. The TIA Portal application itself is left running.',
    async () => {
      if (!launcher) {
        return {
          content: [{ type: 'text' as const, text: 'No persistent watcher to shut down.' }],
          isError: true,
        };
      }
      // Swap the executor BEFORE awaiting shutdown - if shutdown throws
      // mid-flight, we don't want the proxy still pointing at a dead launcher.
      executor.swapNow(new HeadlessExecutor(config));
      ctx.executionMode = 'headless';
      try {
        await launcher.shutdown();
        return {
          content: [{ type: 'text' as const, text: 'Watcher shut down successfully (TIA Portal left running).' }],
          isError: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Shutdown failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  s.tool(
    'eval_powershell',
    "[DEV] Execute arbitrary PowerShell inside the TIA Portal watcher process. The supplied code runs with the session globals available ($Global:TiaPortal, $Global:TiaProject, Write-Log for captured output). The call returns success if SCRIPT_SUCCESS is printed. Intended for Openness API audits, NOT routine use. Common helpers already loaded: Ensure-Portal, Ensure-ProjectOpen, Ensure-PlcSoftware, Get-EngService.",
    {
      code: z.string().describe("PowerShell 5.1 source. Use Write-Log for captured output. Must print `SCRIPT_SUCCESS` (literal) for the tool to report success."),
      timeoutMs: z.number().int().positive().optional().describe("Timeout in ms (default 30000)."),
    },
    async (args: { code: string; timeoutMs?: number }) => {
      if (!config.allowEval) {
        return {
          content: [{
            type: 'text' as const,
            text: 'eval_powershell is disabled by default because it executes arbitrary PowerShell inside the watcher. Restart the server with --allow-eval to enable it.',
          }],
          isError: true,
        };
      }
      const result = await executor.executeScript(args.code, args.timeoutMs ?? G_EVAL_DEFAULT_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      return {
        content: [{
          type: 'text' as const,
          text: success
            ? result.output
            : `eval_powershell failed.\n--- output ---\n${result.output}${result.error ? '\n--- error ---\n' + result.error : ''}`,
        }],
        isError: !success,
      };
    }
  );

  s.tool(
    'get_tia_status',
    'Get the current status of the TIA Portal watcher (state, PID, mode).',
    async () => {
      const status = launcher ? launcher.getStatus() : {
        state: 'stopped',
        pid: null,
        sessionId: null,
        ipcDir: null,
        startedAt: null,
        lastError: null,
      };
      const text = [
        `State: ${status.state}`,
        `Mode: ${ctx.executionMode}`,
        `PID: ${status.pid ?? 'N/A'}`,
        `Session: ${status.sessionId ?? 'N/A'}`,
        `Started: ${status.startedAt ? new Date(status.startedAt).toISOString() : 'N/A'}`,
        status.lastError ? `Last Error: ${status.lastError}` : null,
      ].filter(Boolean).join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        isError: false,
      };
    }
  );
}
