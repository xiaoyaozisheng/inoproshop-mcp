/**
 * FC_RegisterRuntimeTools - 在线/运行时工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 9 个工具：connect_to_device / set_credentials / set_simulation_mode /
 * disconnect_from_device / get_application_state / read_variable /
 * write_variable / download_to_device / start_stop_application。
 * 对应原 server.ts "Online/Runtime Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { formatToolResponse } from './FC_ToolResponse';
import { resolvePath } from '../010_Core/FC_PathUtils';
import { parseResultJson } from '../040_Services/FC_ResultParser';
import { G_ONLINE_OP_TIMEOUT_MS, G_HEAVY_OP_TIMEOUT_MS } from '../020_Config/G_Config';

export function registerRuntimeTools(s: any, ctx: ToolContext): void {
  const { scriptManager, executor, workspaceDir } = ctx;

  s.tool(
    'connect_to_device',
    'Connects (logs in) to the PLC runtime for the active application. If ipAddress is provided, set_gateway_and_address is called on the device first; otherwise the device must already have a configured gateway/address (or be in simulation mode via set_simulation_mode).',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      ipAddress: z.string().optional().describe("Optional PLC IP address. Sets the device gateway/address before login. Leave unset to use whatever is configured on the device, or to use simulation mode."),
      gatewayName: z.string().optional().describe("Informational on TIA Portal (Openness has no gateway model); recorded with the connection target."),
    },
    async (args: { projectFilePath: string; ipAddress?: string; gatewayName?: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'connect_to_device',
        {
          PROJECT_FILE_PATH: escaped,
          IP_ADDRESS: (args.ipAddress || '').trim(),
          GATEWAY_NAME: (args.gatewayName || '').trim(),
        },
        ['ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script, G_ONLINE_OP_TIMEOUT_MS);
      return formatToolResponse(result, `Connected to device for ${args.projectFilePath}.`);
    }
  );

  s.tool(
    'set_credentials',
    'Set default username/password used for subsequent PLC logins. Use this once per session before connect_to_device when the runtime requires authentication. Credentials are recorded for the session; TIA protection dialogs must still be answered in the UI.',
    {
      username: z.string().min(1).describe("Username (must be non-empty)."),
      password: z.string().describe("Password."),
    },
    async (args: { username: string; password: string }) => {
      const script = scriptManager.prepareScript(
        'set_credentials',
        { USERNAME: args.username, PASSWORD: args.password }
      );
      const result = await executor.executeScript(script, 10_000);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      return {
        content: [{ type: 'text' as const, text: `Default credentials set (user='${args.username}').` }],
        isError: false,
      };
    }
  );

  s.tool(
    'set_simulation_mode',
    'Toggle PLC simulation mode on/off for the project Device. Best-effort PLCSIM control via the Openness download API; may require manual PLCSIM start on some TIA versions.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      enable: z.boolean().describe("True to enable simulation mode, false to disable."),
      verbose: z.boolean().optional().describe("If true, return the full script output (device list, verification, etc.). Default false returns a terse summary."),
    },
    async (args: { projectFilePath: string; enable: boolean; verbose?: boolean }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'set_simulation_mode',
        { PROJECT_FILE_PATH: escaped, ENABLE: args.enable ? 'true' : 'false' },
        ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, 30_000);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      if (args.verbose === true) {
        return { content: [{ type: 'text' as const, text: result.output }], isError: false };
      }
      const afterMatch = result.output.match(/Simulation After:\s*(.+)/);
      const after = afterMatch ? afterMatch[1].trim() : 'unknown';
      return {
        content: [{ type: 'text' as const, text: `Simulation mode ${args.enable ? 'enabled' : 'disabled'} on device. Current state: ${after}` }],
        isError: false,
      };
    }
  );

  s.tool(
    'disconnect_from_device',
    'Disconnects (logs out) from the PLC runtime. No-op (success) if not connected.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'disconnect_from_device', { PROJECT_FILE_PATH: escaped },
        ['ensure_project_open']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(result, `Disconnected from device for ${args.projectFilePath}.`);
    }
  );

  s.tool(
    'get_application_state',
    'Report the running PLC application state (run / stop / exception) plus login status. Connect first.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'get_application_state', { PROJECT_FILE_PATH: escaped },
        ['ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script);

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) {
        return formatToolResponse(result, '');
      }

      // Parse state from output
      const stateMatch = result.output.match(/State:\s*(.+)/);
      const loggedInMatch = result.output.match(/Logged In:\s*(.+)/);
      const appMatch = result.output.match(/Application:\s*(.+)/);

      const text = [
        `Application: ${appMatch ? appMatch[1].trim() : 'Unknown'}`,
        `State: ${stateMatch ? stateMatch[1].trim() : 'Unknown'}`,
        `Logged In: ${loggedInMatch ? loggedInMatch[1].trim() : 'Unknown'}`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        isError: false,
      };
    }
  );

  s.tool(
    'read_variable',
    "Read a live variable from the running PLC. Path format: 'GVL_Name.varname' or 'PRG_Name.varname' (no 'Application.' prefix). Struct members: 'GVL.stFrame.aRoi[0].iValueMm'. Connect first.",
    {
      projectFilePath: z.string().describe("Path to the project file."),
      variablePath: z.string().describe("Variable path. Examples: 'GVL_TestControl.iScenario', 'PLC_PRG.bMotor', 'GVL_Cameras.stCam.aRoi[3].iValueMm'. No 'Application.' prefix."),
    },
    async (args: { projectFilePath: string; variablePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'read_variable',
        {
          PROJECT_FILE_PATH: escaped,
          VARIABLE_PATH: args.variablePath.trim(),
        },
        ['_text_utils', 'ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script);

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) {
        return formatToolResponse(result, '');
      }

      // Parse the structured RESULT_JSON block; multi-line struct values
      // survive intact via this channel (the previous regex Value: capture
      // truncated at the first newline).
      const parsed = parseResultJson<{ variable: string; value: string | null; type: string | null; raw: string | null; application: string }>(result.output);
      if (!parsed.ok) {
        return formatToolResponse(result, '');
      }
      const text = `${parsed.data.variable} = ${parsed.data.value ?? 'N/A'} (${parsed.data.type ?? 'unknown'})`;
      return {
        content: [{ type: 'text' as const, text }],
        isError: false,
      };
    }
  );

  s.tool(
    'write_variable',
    "Write a value to a PLC variable via V3's set_prepared_value + force_prepared_values. The variable is FORCED at the new value until unforced (or runtime restart). Use for control flags and test injection, not program outputs. Connect first.",
    {
      projectFilePath: z.string().describe("Path to the project file."),
      variablePath: z.string().describe("Variable path (e.g., 'GVL_TestControl.xEnable', 'PLC_PRG.iScenario'). No 'Application.' prefix."),
      value: z.string().describe("Value to write as IEC literal (e.g., 'TRUE', '42', 'INT#-3', '3.14')."),
    },
    async (args: { projectFilePath: string; variablePath: string; value: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'write_variable',
        {
          PROJECT_FILE_PATH: escaped,
          VARIABLE_PATH: args.variablePath.trim(),
          VARIABLE_VALUE: args.value,
        },
        ['ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Variable '${args.variablePath}' set to '${args.value}'.`
      );
    }
  );

  s.tool(
    'download_to_device',
    "Downloads the compiled application to the PLC device. mode controls strategy: 'auto' (default) tries online change then falls back to full; 'online_change' fails if online change is rejected; 'full' always does a full download.",
    {
      projectFilePath: z.string().describe("Path to the project file."),
      mode: z.enum(['auto', 'online_change', 'full']).optional().describe("Download strategy. Default 'auto'."),
    },
    async (args: { projectFilePath: string; mode?: 'auto' | 'online_change' | 'full' }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const mode = args.mode || 'auto';
      const script = scriptManager.prepareScriptWithHelpers(
        'download_to_device',
        { PROJECT_FILE_PATH: escaped, MODE: mode },
        ['ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS);
      return formatToolResponse(result, `Application downloaded to device for ${args.projectFilePath} (mode=${mode}).`);
    }
  );

  s.tool(
    'start_stop_application',
    'Starts or stops the PLC application on the connected device.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      action: z.enum(['start', 'stop']).describe("Action to perform."),
    },
    async (args: { projectFilePath: string; action: 'start' | 'stop' }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'start_stop_application',
        {
          PROJECT_FILE_PATH: escaped,
          APP_ACTION: args.action,
        },
        ['ensure_project_open', 'ensure_online_connection']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Application ${args.action} executed for ${args.projectFilePath}.`
      );
    }
  );
}
