/**
 * FC_RegisterStructureTools - 工程结构工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 7 个工具：create_dut / create_gvl / create_folder / delete_object /
 * rename_object / get_all_pou_code / search_code。
 * 对应原 server.ts "Project Structure Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { formatToolResponse } from './FC_ToolResponse';
import { resolvePath, sanitizePouPath } from '../010_Core/FC_PathUtils';
import { parseResultJson } from '../040_Services/FC_ResultParser';
import { G_HEAVY_OP_TIMEOUT_MS } from '../020_Config/G_Config';

export function registerStructureTools(s: any, ctx: ToolContext): void {
  const { scriptManager, executor, workspaceDir } = ctx;

  s.tool(
    'create_dut',
    'Creates a new Data Unit Type (DUT) - structure, enumeration, union, or alias - within the specified TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      name: z.string().min(1).describe("Name for the new DUT (must be a valid IEC identifier)."),
      dutType: z.enum(['Structure', 'Enumeration', 'Union', 'Alias']).describe("Type of DUT."),
      parentPath: z.string().min(1).describe("Relative path under project root or application (e.g., 'Application')."),
    },
    async (args: { projectFilePath: string; name: string; dutType: 'Structure' | 'Enumeration' | 'Union' | 'Alias'; parentPath: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_dut',
        {
          PROJECT_FILE_PATH: escProjPath,
          DUT_NAME: args.name.trim(),
          DUT_TYPE_STR: args.dutType,
          PARENT_PATH: sanParentPath,
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `DUT '${args.name}' (${args.dutType}) created in '${sanParentPath}' of ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'create_gvl',
    'Creates a new Global Variable List (GVL) within the specified TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      name: z.string().describe("Name for the new GVL (must be a valid IEC identifier)."),
      parentPath: z.string().describe("Relative path under project root or application (e.g., 'Application')."),
      declarationCode: z.string().optional().describe("Optional initial declaration code for the GVL (VAR_GLOBAL...END_VAR)."),
    },
    async (args: { projectFilePath: string; name: string; parentPath: string; declarationCode?: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_gvl',
        {
          PROJECT_FILE_PATH: escProjPath,
          GVL_NAME: args.name.trim(),
          PARENT_PATH: sanParentPath,
          DECLARATION_CONTENT: args.declarationCode ?? '',
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `GVL '${args.name}' created in '${sanParentPath}' of ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'create_folder',
    'Creates an organizational folder within the TIA Portal project tree.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      folderName: z.string().describe("Name for the new folder."),
      parentPath: z.string().describe("Relative path under project root or application (e.g., 'Application')."),
    },
    async (args: { projectFilePath: string; folderName: string; parentPath: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_folder',
        {
          PROJECT_FILE_PATH: escProjPath,
          FOLDER_NAME: args.folderName.trim(),
          PARENT_PATH: sanParentPath,
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Folder '${args.folderName}' created in '${sanParentPath}' of ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'delete_object',
    'Deletes a project object (POU, DUT, GVL, folder, etc.) from the TIA Portal project. WARNING: This is destructive and cannot be undone. System nodes (Application, Device, Plc Logic, Library Manager, Project Settings, Task Configuration, etc.) are refused.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      objectPath: z.string().describe("Full relative path to the object to delete (e.g., 'Application/MyPOU')."),
    },
    async (args: { projectFilePath: string; objectPath: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanObjPath = sanitizePouPath(args.objectPath);
      // Refuse to delete system nodes by EXACT PATH MATCH - the previous
      // last-segment-only check produced false positives (a user folder
      // named `MainTask` under `Application/SomeFolder/MainTask` was wrongly
      // refused). Match the exact canonical paths instead, plus reject any
      // top-level path (no `/`).
      const SYSTEM_PATHS = new Set([
        'Application',
        'Device',
        'Project Settings',
        '__VisualizationStyle',
        'Device/Plc Logic',
        'Device/Plc Logic/Application',
        'Application/Library Manager',
        'Device/Plc Logic/Application/Library Manager',
        'Application/Task Configuration',
        'Device/Plc Logic/Application/Task Configuration',
        'Application/Task Configuration/MainTask',
        'Device/Plc Logic/Application/Task Configuration/MainTask',
        'Device/Communication',
        'Device/Communication/Ethernet',
        'Device/SoftMotion General Axis Pool',
      ]);
      if (sanObjPath === '' || !sanObjPath.includes('/') || SYSTEM_PATHS.has(sanObjPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Refused: '${sanObjPath || '(empty)'}' is a system node or top-level object. delete_object only operates on user objects nested under a parent (e.g. 'Application/MyPOU').`,
          }],
          isError: true,
        };
      }
      const script = scriptManager.prepareScriptWithHelpers(
        'delete_object',
        {
          PROJECT_FILE_PATH: escProjPath,
          OBJECT_PATH: sanObjPath,
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Object '${sanObjPath}' deleted from ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'rename_object',
    'Renames a project object (POU, DUT, GVL, folder, etc.) in the TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      objectPath: z.string().describe("Full relative path to the object to rename (e.g., 'Application/MyPOU')."),
      newName: z.string().describe("New name for the object (must be a valid IEC identifier)."),
    },
    async (args: { projectFilePath: string; objectPath: string; newName: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanObjPath = sanitizePouPath(args.objectPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'rename_object',
        {
          PROJECT_FILE_PATH: escProjPath,
          OBJECT_PATH: sanObjPath,
          NEW_NAME: args.newName.trim(),
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Object '${sanObjPath}' renamed to '${args.newName}' in ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'get_all_pou_code',
    'Reads the declaration and implementation code of every POU/DUT/GVL in the project. Returns all code in a single response for bulk review.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'get_all_pou_code', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS); // 120s for large projects

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) {
        return formatToolResponse(result, '');
      }

      // Parse the JSON output
      const codeStartMarker = '### ALL_POU_CODE_START ###';
      const codeEndMarker = '### ALL_POU_CODE_END ###';
      const startIdx = result.output.indexOf(codeStartMarker);
      const endIdx = result.output.indexOf(codeEndMarker);

      if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
        return {
          content: [{ type: 'text' as const, text: 'Could not parse POU code output.' }],
          isError: true,
        };
      }

      try {
        const jsonStr = result.output.substring(startIdx + codeStartMarker.length, endIdx).trim();
        const allCode: Array<{ path: string; type: string; declaration?: string; implementation?: string }> = JSON.parse(jsonStr);

        if (allCode.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No POUs with code found in the project.' }],
            isError: false,
          };
        }

        // Format output
        const sections = allCode.map((item) => {
          let section = `\n=== ${item.path} (${item.type}) ===`;
          if (item.declaration) {
            section += `\n// ----- Declaration -----\n${item.declaration}`;
          }
          if (item.implementation) {
            section += `\n// ----- Implementation -----\n${item.implementation}`;
          }
          return section;
        });

        return {
          content: [{ type: 'text' as const, text: `${allCode.length} object(s) with code:\n${sections.join('\n')}` }],
          isError: false,
        };
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Failed to parse POU code JSON.' }],
          isError: true,
        };
      }
    }
  );

  s.tool(
    'search_code',
    'Regex (or literal substring) search across every POU/Method/Property/DUT/GVL textual body. Returns file:line:col hits. Graphical bodies with no textual_implementation are skipped.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      pattern: z.string().min(1).describe("Pattern to search for. Treated as a regex unless regex=false."),
      regex: z.boolean().optional().describe("If true (default), pattern is a regex. If false, pattern is a literal substring."),
      caseSensitive: z.boolean().optional().describe("If true (default), matching is case-sensitive."),
      includeDeclaration: z.boolean().optional().describe("If true (default), search declaration sections."),
      includeImplementation: z.boolean().optional().describe("If true (default), search implementation sections."),
      maxHits: z.number().int().positive().optional().describe("Cap the number of returned hits (default 1000)."),
    },
    async (args: {
      projectFilePath: string;
      pattern: string;
      regex?: boolean;
      caseSensitive?: boolean;
      includeDeclaration?: boolean;
      includeImplementation?: boolean;
      maxHits?: number;
    }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'search_code',
        {
          PROJECT_FILE_PATH: escaped,
          PATTERN: args.pattern,
          USE_REGEX: (args.regex ?? true) ? '1' : '0',
          CASE_SENSITIVE: (args.caseSensitive ?? true) ? '1' : '0',
          INCLUDE_DECL: (args.includeDeclaration ?? true) ? '1' : '0',
          INCLUDE_IMPL: (args.includeImplementation ?? true) ? '1' : '0',
          MAX_HITS: String(args.maxHits ?? 1000),
        },
        ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        hits: Array<{ path: string; section: string; line: number; col: number; text: string; match: string }>;
        count: number;
        truncated: boolean;
        pattern: string;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      const { hits, count, truncated } = parsed.data;
      if (count === 0) {
        return {
          content: [{ type: 'text' as const, text: `No matches for /${args.pattern}/ in project.` }],
          isError: false,
        };
      }
      const lines = hits.map(h =>
        `${h.path}:${h.line}:${h.col} (${h.section}) ${h.text.trim()}`
      );
      const header = `${count} match(es)${truncated ? ' (truncated to maxHits)' : ''}:`;
      return {
        content: [{ type: 'text' as const, text: `${header}\n${lines.join('\n')}` }],
        isError: false,
      };
    }
  );
}
