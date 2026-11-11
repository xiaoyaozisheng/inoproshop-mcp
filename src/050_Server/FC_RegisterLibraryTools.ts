/**
 * FC_RegisterLibraryTools - 库/设备/符号工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 11 个工具：list_project_libraries / list_device_repository /
 * map_io_channel / inspect_device_node / add_device / set_device_parameter /
 * find_references / rename_symbol / monitor_variables /
 * create_project_archive / add_library。
 * 对应原 server.ts "Library Management Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { formatToolResponse } from './FC_ToolResponse';
import { resolvePath, sanitizePouPath } from '../010_Core/FC_PathUtils';
import { parseResultJson } from '../040_Services/FC_ResultParser';
import {
  G_ONLINE_OP_TIMEOUT_MS,
  G_HEAVY_OP_TIMEOUT_MS,
  G_MONITOR_MAX_DURATION_MS,
  G_MONITOR_MIN_INTERVAL_MS,
} from '../020_Config/G_Config';

export function registerLibraryTools(s: any, ctx: ToolContext): void {
  const { scriptManager, executor, workspaceDir } = ctx;

  s.tool(
    'list_project_libraries',
    'Lists all libraries currently referenced in the TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'list_project_libraries', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script);

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) {
        return formatToolResponse(result, '');
      }

      // Parse libraries JSON
      const libStartMarker = '### LIBRARIES_START ###';
      const libEndMarker = '### LIBRARIES_END ###';
      const startIdx = result.output.indexOf(libStartMarker);
      const endIdx = result.output.indexOf(libEndMarker);

      if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
        return {
          content: [{ type: 'text' as const, text: 'Could not parse libraries output.' }],
          isError: true,
        };
      }

      try {
        const jsonStr = result.output.substring(startIdx + libStartMarker.length, endIdx).trim();
        const libraries: Array<{ name: string; version?: string; company?: string }> = JSON.parse(jsonStr);

        if (libraries.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No libraries found in the project (or Library Manager not found).' }],
            isError: false,
          };
        }

        const lines = libraries.map((lib) => {
          let line = `- ${lib.name}`;
          if (lib.version) line += ` (v${lib.version})`;
          if (lib.company) line += ` [${lib.company}]`;
          return line;
        });

        return {
          content: [{ type: 'text' as const, text: `${libraries.length} library/libraries:\n${lines.join('\n')}` }],
          isError: false,
        };
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Failed to parse libraries JSON.' }],
          isError: true,
        };
      }
    }
  );

  s.tool(
    'list_device_repository',
    "Enumerate device descriptors from the local hardware catalog (not available via Openness). Returns {name, vendor, device_type, device_id, version, description, category} per entry. Use to discover canonical ids for add_device.",
    {
      vendor: z.string().optional().describe("Optional case-insensitive vendor substring filter (e.g. '3S', 'ifm', 'Beckhoff')."),
      nameContains: z.string().optional().describe("Optional case-insensitive substring filter on the device name."),
      maxResults: z.number().int().positive().optional().describe("Cap on returned entries (default 500)."),
    },
    async (args: { vendor?: string; nameContains?: string; maxResults?: number }) => {
      // No project context needed - this hits the GLOBAL repository on the
      // TIA Portal instance. The script doesn't include ensure_project_open or
      // require_project_open in its helper chain.
      const script = scriptManager.prepareScriptWithHelpers(
        'list_device_repository',
        {
          VENDOR_FILTER: args.vendor ?? '',
          NAME_FILTER: args.nameContains ?? '',
          MAX_RESULTS: String(args.maxResults ?? 500),
        },
        ['_text_utils']
      );
      const result = await executor.executeScript(script, G_ONLINE_OP_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        devices: Array<{ name: string | null; vendor: string | null; device_type: number | null; device_id: number | null; version: string | null; category: string | null; description: string | null }>;
        count: number;
        truncated: boolean;
        total_in_repo: number;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed.data, null, 2) }],
        isError: false,
      };
    }
  );

  s.tool(
    'map_io_channel',
    "Bind (or clear) a fieldbus I/O channel to a global variable symbol. Use inspect_device_node first to discover the channel layout.",
    {
      projectFilePath: z.string().describe("Path to the project file."),
      devicePath: z.string().min(1).describe("Path to the device node (e.g. 'Device/Ethernet/EIP_Adapter')."),
      channelPath: z.string().min(1).describe("Channel address relative to the device. Either a name path ('Inputs/Byte 0/Bit 3') or numeric indices ('0/3')."),
      variableName: z.string().optional().describe("Global variable to bind (e.g. 'GVL.bSensor', 'PLC_PRG.xMotor'). Required unless clearBinding is true."),
      clearBinding: z.boolean().optional().describe("If true, remove the existing binding instead of setting one. variableName is ignored."),
    },
    async (args: {
      projectFilePath: string;
      devicePath: string;
      channelPath: string;
      variableName?: string;
      clearBinding?: boolean;
    }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const sanDev = sanitizePouPath(args.devicePath);
      const script = scriptManager.prepareScriptWithHelpers(
        'map_io_channel',
        {
          PROJECT_FILE_PATH: escProj,
          DEVICE_PATH: sanDev,
          CHANNEL_PATH: args.channelPath,
          VARIABLE_NAME: args.variableName ?? '',
          CLEAR_BINDING: args.clearBinding ? '1' : '0',
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script, 30_000);
      return formatToolResponse(
        result,
        args.clearBinding
          ? `Cleared I/O channel binding at '${sanDev}/${args.channelPath}'. Project saved.`
          : `Bound '${sanDev}/${args.channelPath}' -> ${args.variableName}. Project saved.`
      );
    }
  );

  s.tool(
    'inspect_device_node',
    'Read-only introspection of a device node: descriptor metadata, parameter list with current values, child sub-devices. Pair with set_device_parameter to discover writable IDs.',
    {
      projectFilePath: z.string().describe("Path to the project file (must be the currently-open project)."),
      devicePath: z.string().min(1).describe("Path to the device node, e.g. 'Device' for the PLC root, 'Device/Ethernet/EIP_Adapter' for a fieldbus adapter."),
    },
    async (args: { projectFilePath: string; devicePath: string }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const sanDev = sanitizePouPath(args.devicePath);
      const script = scriptManager.prepareScriptWithHelpers(
        'inspect_device_node',
        { PROJECT_FILE_PATH: escProj, DEVICE_PATH: sanDev },
        ['_text_utils', 'require_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script, 30_000);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed.data, null, 2) }],
        isError: false,
      };
    }
  );

  s.tool(
    'add_device',
    'Add a device under an existing parent device. Use list_device_repository to source canonical deviceType/deviceId/version. Wrong ids produce a wrong-but-syntactically-valid node that fails at compile time.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      parentDevicePath: z.string().min(1).describe("Path to the parent device in the project tree, e.g. 'Device' for the root PLC, 'Device/Ethernet' for a fieldbus master."),
      deviceName: z.string().min(1).describe("Name for the new device node (must be a valid TIA object name)."),
      deviceType: z.number().int().describe("device type id (informational: Openness cannot create stations)."),
      deviceId: z.number().int().optional().describe("device id (informational: Openness cannot create stations)."),
      version: z.string().optional().describe("Version string for the device (e.g. '3.5.16.0')."),
    },
    async (args: {
      projectFilePath: string;
      parentDevicePath: string;
      deviceName: string;
      deviceType: number;
      deviceId?: number;
      version?: string;
    }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const sanParent = sanitizePouPath(args.parentDevicePath);
      const script = scriptManager.prepareScriptWithHelpers(
        'add_device',
        {
          PROJECT_FILE_PATH: escProj,
          PARENT_DEVICE_PATH: sanParent,
          DEVICE_NAME: args.deviceName.trim(),
          DEVICE_TYPE: String(args.deviceType),
          DEVICE_ID: args.deviceId !== undefined ? String(args.deviceId) : '',
          DEVICE_VERSION: args.version ?? '',
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script, G_ONLINE_OP_TIMEOUT_MS);
      return formatToolResponse(
        result,
        `Device '${args.deviceName}' added under '${sanParent}' in ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'set_device_parameter',
    'EXPERIMENTAL. Set a parameter value on a device. Use inspect_device_node first to find writable IDs. Many fieldbus parameters are GUI-only; this tool returns a clear error in that case.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      devicePath: z.string().min(1).describe("Path to the device in the project tree, e.g. 'Device/Ethernet/EIP_Adapter_X'."),
      parameterId: z.union([z.number().int(), z.string().min(1)]).describe("Parameter id (attribute name from inspect_device_node)."),
      value: z.string().describe("Value to write. Use the type-appropriate textual representation (e.g. '192.168.1.10' for IP, 'TRUE' for BOOL, '42' for INT)."),
    },
    async (args: {
      projectFilePath: string;
      devicePath: string;
      parameterId: number | string;
      value: string;
    }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const sanDev = sanitizePouPath(args.devicePath);
      const script = scriptManager.prepareScriptWithHelpers(
        'set_device_parameter',
        {
          PROJECT_FILE_PATH: escProj,
          DEVICE_PATH: sanDev,
          PARAMETER_ID: String(args.parameterId),
          VALUE: args.value,
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script, 30_000);
      return formatToolResponse(
        result,
        `Parameter ${args.parameterId} on '${sanDev}' set to '${args.value}'. Project saved.`
      );
    }
  );

  s.tool(
    'find_references',
    'Find every word-boundary reference to a symbol (\\bsymbol\\b) across textual POU/Method/Property/DUT/GVL bodies. Wraps search_code. Comments and string literals are not excluded.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      symbol: z.string().min(1).describe("Identifier to find references to (e.g. 'GVL_Cameras', 'fbParser1')."),
      caseSensitive: z.boolean().optional().describe("If true (default), match case-sensitively per IEC 61131-3 conventions."),
      maxHits: z.number().int().positive().optional().describe("Cap on returned hits (default 1000)."),
    },
    async (args: {
      projectFilePath: string;
      symbol: string;
      caseSensitive?: boolean;
      maxHits?: number;
    }) => {
      // Word-boundary regex - escape any regex metacharacters that might
      // appear in the symbol (defensive: IEC identifiers can't contain them,
      // but a malformed input shouldn't blow up the search).
      const escaped = args.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = `\\b${escaped}\\b`;
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'search_code',
        {
          PROJECT_FILE_PATH: escProj,
          PATTERN: pattern,
          USE_REGEX: '1',
          CASE_SENSITIVE: (args.caseSensitive ?? true) ? '1' : '0',
          INCLUDE_DECL: '1',
          INCLUDE_IMPL: '1',
          MAX_HITS: String(args.maxHits ?? 1000),
        },
        ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        hits: Array<{ path: string; section: string; line: number; col: number; text: string }>;
        count: number;
        truncated: boolean;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      const { hits, count, truncated } = parsed.data;
      if (count === 0) {
        return {
          content: [{ type: 'text' as const, text: `No references to '${args.symbol}' found.` }],
          isError: false,
        };
      }
      const lines = hits.map(h => `${h.path}:${h.line}:${h.col} (${h.section}) ${h.text.trim()}`);
      const header = `${count} reference(s) to '${args.symbol}'${truncated ? ' (truncated)' : ''}:`;
      return {
        content: [{ type: 'text' as const, text: `${header}\n${lines.join('\n')}` }],
        isError: false,
      };
    }
  );

  s.tool(
    'rename_symbol',
    'Best-effort word-boundary textual rename across textual POU/Method/Property/DUT/GVL bodies. Defaults to dryRun=true. Does not rename the project object node (use rename_object) or graphical bodies.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      oldName: z.string().min(1).describe("Existing symbol name."),
      newName: z.string().min(1).describe("Replacement name."),
      dryRun: z.boolean().optional().describe("If true (default), report matches without writing. Set false to apply."),
      includeDeclaration: z.boolean().optional().describe("If true (default), rewrite declaration sections."),
      includeImplementation: z.boolean().optional().describe("If true (default), rewrite implementation sections."),
    },
    async (args: {
      projectFilePath: string;
      oldName: string;
      newName: string;
      dryRun?: boolean;
      includeDeclaration?: boolean;
      includeImplementation?: boolean;
    }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const dry = args.dryRun ?? true;
      const script = scriptManager.prepareScriptWithHelpers(
        'rename_symbol',
        {
          PROJECT_FILE_PATH: escProj,
          OLD_NAME: args.oldName,
          NEW_NAME: args.newName,
          DRY_RUN: dry ? '1' : '0',
          INCLUDE_DECL: (args.includeDeclaration ?? true) ? '1' : '0',
          INCLUDE_IMPL: (args.includeImplementation ?? true) ? '1' : '0',
        },
        ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        old_name: string;
        new_name: string;
        dry_run: boolean;
        changes: Array<{ path: string; section: string; match_count: number; applied: boolean }>;
        total_matches: number;
        applied_count: number;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      const { dry_run, total_matches, applied_count, changes } = parsed.data;
      if (total_matches === 0) {
        return {
          content: [{ type: 'text' as const, text: `No matches for '${args.oldName}'; nothing renamed.` }],
          isError: false,
        };
      }
      const summary = changes.map(c =>
        `${c.path} [${c.section}]: ${c.match_count} match(es)${dry_run ? '' : c.applied ? ' (applied)' : ' (NOT applied)'}`
      );
      const header = dry_run
        ? `DRY RUN: ${total_matches} match(es) of '${args.oldName}' -> '${args.newName}' across ${changes.length} section(s). Re-run with dryRun=false to apply.`
        : `Applied ${total_matches} replacement(s) of '${args.oldName}' -> '${args.newName}' across ${applied_count} section(s). Project saved.`;
      return {
        content: [{ type: 'text' as const, text: `${header}\n${summary.join('\n')}` }],
        isError: false,
      };
    }
  );

  s.tool(
    'monitor_variables',
    "Sample one or more PLC variables at a fixed interval over a bounded duration; returns the timeseries. Unsupported on TIA Portal Openness (no online API).",
    {
      projectFilePath: z.string().describe("Path to the project file."),
      variablePaths: z.array(z.string().min(1)).min(1).describe("List of variable paths to sample (e.g. ['PLC_PRG.x', 'GVL.nCounter'])."),
      durationMs: z.number().int().positive().describe("Total sampling duration in ms. Capped at 60000."),
      intervalMs: z.number().int().positive().describe("Sample interval in ms. Floor 10ms."),
    },
    async (args: {
      projectFilePath: string;
      variablePaths: string[];
      durationMs: number;
      intervalMs: number;
    }) => {
      // Clamp here so TS-side timeouts and the script-side cap stay consistent
      // (the script also clamps to 60000 defensively, but a caller asking for
      // 120000 deserves a fast fail-and-warn rather than silent truncation).
      const clampedDuration = Math.min(args.durationMs, G_MONITOR_MAX_DURATION_MS);
      const clampedInterval = Math.max(args.intervalMs, G_MONITOR_MIN_INTERVAL_MS);
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'monitor_variables',
        {
          PROJECT_FILE_PATH: escaped,
          VARIABLES_JSON: JSON.stringify(args.variablePaths),
          DURATION_MS: String(clampedDuration),
          INTERVAL_MS: String(clampedInterval),
        },
        ['_text_utils', 'ensure_project_open', 'ensure_online_connection']
      );
      // Per-call timeout = clamped duration + 30s headroom for connect/return.
      const callTimeoutMs = clampedDuration + 30_000;
      const result = await executor.executeScript(script, callTimeoutMs);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        variables: string[];
        sample_count: number;
        duration_ms_requested: number;
        duration_ms_actual: number;
        interval_ms: number;
        application: string;
        samples: Array<{ t_ms: number; values: Record<string, string | null> }>;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      // Caller wants the full timeseries - return it as JSON in the message
      // body (not summarised) so plotting tools downstream can parse it.
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(parsed.data, null, 2),
        }],
        isError: false,
      };
    }
  );

  s.tool(
    'create_project_archive',
    'Saves the currently-open project as a .projectarchive. Read-only with respect to the project itself - the project must already be open (this tool will not switch projects). Output path may be absolute or relative to the workspace.',
    {
      projectFilePath: z.string().describe("Path to the project file (must be the currently-open project)."),
      outputPath: z.string().min(1).describe("Output .projectarchive path (absolute or workspace-relative)."),
      comment: z.string().optional().describe("Optional comment embedded in the archive metadata."),
      includeLibraries: z.boolean().optional().describe("If true (default), include referenced library sources in the archive."),
      includeCompiledLibraries: z.boolean().optional().describe("If true (default), include compiled library binaries. Set false to keep archives small for plain-text version control."),
    },
    async (args: {
      projectFilePath: string;
      outputPath: string;
      comment?: string;
      includeLibraries?: boolean;
      includeCompiledLibraries?: boolean;
    }) => {
      const escProj = resolvePath(args.projectFilePath, workspaceDir);
      const escOut = resolvePath(args.outputPath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_project_archive',
        {
          PROJECT_FILE_PATH: escProj,
          ARCHIVE_PATH: escOut,
          COMMENT: args.comment ?? '',
          INCLUDE_LIBRARIES: (args.includeLibraries ?? true) ? '1' : '0',
          INCLUDE_COMPILED: (args.includeCompiledLibraries ?? true) ? '1' : '0',
        },
        ['_text_utils', 'require_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{ archive_path: string; size_bytes: number; comment: string | null }>(result.output);
      const sizeKb = parsed.ok ? Math.round(parsed.data.size_bytes / 1024) : 0;
      return {
        content: [{
          type: 'text' as const,
          text: parsed.ok
            ? `Archive saved to ${parsed.data.archive_path} (${sizeKb} KB).${parsed.data.comment ? ` Comment: "${parsed.data.comment}".` : ''}`
            : `Archive saved (output details unavailable).`,
        }],
        isError: false,
      };
    }
  );

  s.tool(
    'add_library',
    'Adds a library reference to the TIA Portal project. The library must be installed on this machine (global library folders).',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      libraryName: z.string().describe("Name of the library to add (e.g., 'Standard', 'Util', 'CAA Memory')."),
    },
    async (args: { projectFilePath: string; libraryName: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'add_library',
        {
          PROJECT_FILE_PATH: escaped,
          LIBRARY_NAME: args.libraryName.trim(),
        },
        ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Library '${args.libraryName}' added to ${args.projectFilePath}. Project saved.`
      );
    }
  );
}
