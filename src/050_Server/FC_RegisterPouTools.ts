/**
 * FC_RegisterPouTools - POU/编译工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 6 个工具：create_pou / set_pou_code / create_property /
 * create_method / compile_project / get_compile_messages。
 * 对应原 server.ts "POU Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { formatToolResponse } from './FC_ToolResponse';
import { resolvePath, sanitizePouPath } from '../010_Core/FC_PathUtils';
import { G_HEAVY_OP_TIMEOUT_MS } from '../020_Config/G_Config';

interface CompileMessage {
  severity: string;
  text: string;
  object?: string;
  line?: number;
}

const COMPILE_MSG_START = '### COMPILE_MESSAGES_START ###';
const COMPILE_MSG_END = '### COMPILE_MESSAGES_END ###';

function parseCompileMessages(output: string): CompileMessage[] {
  const msgStartIdx = output.indexOf(COMPILE_MSG_START);
  const msgEndIdx = output.indexOf(COMPILE_MSG_END);
  if (msgStartIdx !== -1 && msgEndIdx !== -1 && msgStartIdx < msgEndIdx) {
    try {
      const jsonStr = output.substring(msgStartIdx + COMPILE_MSG_START.length, msgEndIdx).trim();
      return JSON.parse(jsonStr);
    } catch {
      // JSON parse failed, ignore
    }
  }
  return [];
}

function formatCompileMsg(m: CompileMessage): string {
  const loc = m.object ? (m.line != null ? ` [${m.object}:${m.line}]` : ` [${m.object}]`) : '';
  return `${m.severity.toUpperCase()}: ${m.text}${loc}`;
}

export function registerPouTools(s: any, ctx: ToolContext): void {
  const { scriptManager, executor, workspaceDir } = ctx;

  s.tool(
    'create_pou',
    'Creates a new Program, Function Block, or Function POU within the specified TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      name: z.string().min(1).describe("Name for the new POU (must be a valid IEC identifier)."),
      type: z.enum(['Program', 'FunctionBlock', 'Function']).describe("Type of POU."),
      language: z.enum(['ST', 'LD', 'FBD', 'SFC', 'IL', 'CFC']).describe("Implementation language."),
      parentPath: z.string().min(1).describe("Relative path under project root or application (e.g., 'Application')."),
    },
    async (args: { projectFilePath: string; name: string; type: 'Program' | 'FunctionBlock' | 'Function'; language: 'ST' | 'LD' | 'FBD' | 'SFC' | 'IL' | 'CFC'; parentPath: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_pou',
        {
          PROJECT_FILE_PATH: escProjPath,
          POU_NAME: args.name.trim(),
          POU_TYPE_STR: args.type,
          IMPL_LANGUAGE_STR: args.language,
          PARENT_PATH: sanParentPath,
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `POU '${args.name}' created in '${sanParentPath}' of ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'set_pou_code',
    'Sets the declaration and/or implementation code for a specific POU, Method, or Property. Omit (or pass empty string for) a section to leave it unchanged.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      pouPath: z.string().min(1).describe("Full relative path to the target object (e.g., 'Application/MyPOU')."),
      declarationCode: z.string().optional().describe("Code for the declaration part (VAR...END_VAR). If omitted or empty, not changed."),
      implementationCode: z.string().optional().describe("Code for the implementation logic. If omitted or empty, not changed."),
    },
    async (args: { projectFilePath: string; pouPath: string; declarationCode?: string; implementationCode?: string }) => {
      // Treat empty string the same as omitted - the previous code silently
      // overwrote the section with an empty string, which was surprising and
      // caused data loss. To explicitly clear a section, pass a single-line
      // placeholder like a comment.
      const declProvided = args.declarationCode !== undefined && args.declarationCode !== '';
      const implProvided = args.implementationCode !== undefined && args.implementationCode !== '';
      if (!declProvided && !implProvided) {
        return {
          content: [{ type: 'text' as const, text: 'Error: At least one of declarationCode or implementationCode must be provided (and non-empty).' }],
          isError: true,
        };
      }
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanPouPath = sanitizePouPath(args.pouPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'set_pou_code',
        {
          PROJECT_FILE_PATH: escProjPath,
          POU_FULL_PATH: sanPouPath,
          DECLARATION_CONTENT: args.declarationCode ?? '',
          IMPLEMENTATION_CONTENT: args.implementationCode ?? '',
          UPDATE_DECL: declProvided ? '1' : '0',
          UPDATE_IMPL: implProvided ? '1' : '0',
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Code set for '${sanPouPath}' in ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'create_property',
    'Creates a new Property within a specific Function Block POU.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      parentPouPath: z.string().describe("Relative path to the parent Function Block POU (e.g., 'Application/MyFB')."),
      propertyName: z.string().describe("Name for the new property (must be a valid IEC identifier)."),
      propertyType: z.string().describe("Data type of the property (e.g., 'BOOL', 'INT', 'MyDUT')."),
    },
    async (args: { projectFilePath: string; parentPouPath: string; propertyName: string; propertyType: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPouPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_property',
        {
          PROJECT_FILE_PATH: escProjPath,
          PARENT_POU_FULL_PATH: sanParentPath,
          PROPERTY_NAME: args.propertyName.trim(),
          PROPERTY_TYPE: args.propertyType.trim(),
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Property '${args.propertyName}' created under '${sanParentPath}' in ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'create_method',
    'Creates a new Method within a specific Function Block POU.',
    {
      projectFilePath: z.string().describe("Path to the project file."),
      parentPouPath: z.string().describe("Relative path to the parent Function Block POU (e.g., 'Application/MyFB')."),
      methodName: z.string().describe("Name of the new method (must be a valid IEC identifier)."),
      returnType: z.string().optional().describe("Return type (e.g., 'BOOL', 'INT'). Leave empty or omit for no return value."),
    },
    async (args: { projectFilePath: string; parentPouPath: string; methodName: string; returnType?: string }) => {
      const escProjPath = resolvePath(args.projectFilePath, workspaceDir);
      const sanParentPath = sanitizePouPath(args.parentPouPath);
      const script = scriptManager.prepareScriptWithHelpers(
        'create_method',
        {
          PROJECT_FILE_PATH: escProjPath,
          PARENT_POU_FULL_PATH: sanParentPath,
          METHOD_NAME: args.methodName.trim(),
          RETURN_TYPE: (args.returnType ?? '').trim(),
        },
        ['_text_utils', 'ensure_project_open', 'find_object_by_path']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(
        result,
        `Method '${args.methodName}' created under '${sanParentPath}' in ${args.projectFilePath}. Project saved.`
      );
    }
  );

  s.tool(
    'compile_project',
    'Compiles (Builds) the PLC software of a TIA Portal project. Returns structured compiler messages (errors, warnings) when available.',
    {
      projectFilePath: z.string().describe("Path to the project file containing the application to compile."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'compile_project', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script, G_HEAVY_OP_TIMEOUT_MS); // 120s timeout for compile

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');

      // Parse structured compile messages if present
      const compileMessages = parseCompileMessages(result.output);

      // Build response message
      let message: string;
      let isError = !success;

      if (!success) {
        message = `Failed initiating compilation for ${args.projectFilePath}. Output:\n${result.output}`;
      } else if (compileMessages.length > 0) {
        const errors = compileMessages.filter((m) => m.severity === 'error');
        const warnings = compileMessages.filter((m) => m.severity === 'warning');

        message = `Compilation complete for ${args.projectFilePath}.\n`;
        message += `${errors.length} error(s), ${warnings.length} warning(s).\n`;
        if (errors.length > 0) {
          message += '\nErrors:\n' + errors.map(formatCompileMsg).join('\n');
          isError = true;
        }
        if (warnings.length > 0) {
          message += '\nWarnings:\n' + warnings.map(formatCompileMsg).join('\n');
        }
      } else {
        // No structured messages available — fall back to old behavior
        message = `Compilation initiated for ${args.projectFilePath}.`;
        const hasCompileErrors =
          result.output.includes('Compile complete --') &&
          !/ 0 error\(s\),/.test(result.output);
        if (hasCompileErrors) {
          message += ' WARNING: Build command reported errors. Use get_compile_messages for details.';
          isError = true;
        }
      }

      return { content: [{ type: 'text' as const, text: message }], isError };
    }
  );

  s.tool(
    'get_compile_messages',
    "Retrieves the last compiler messages (errors, warnings) without triggering a new build. Note: returns the cached results from the last compile_project run; if you've edited code since, run compile_project to refresh.",
    {
      projectFilePath: z.string().describe("Path to the project file."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'get_compile_messages', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script);

      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) {
        return formatToolResponse(result, '');
      }

      // Parse structured messages
      const compileMessages = parseCompileMessages(result.output);

      if (compileMessages.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No compile messages found. The message API may not be available on this TIA Portal version.` }],
          isError: false,
        };
      }

      const errors = compileMessages.filter((m) => m.severity === 'error');
      const warnings = compileMessages.filter((m) => m.severity === 'warning');

      let message = `${errors.length} error(s), ${warnings.length} warning(s), ${compileMessages.length} total message(s).\n`;
      if (errors.length > 0) {
        message += '\nErrors:\n' + errors.map(formatCompileMsg).join('\n');
      }
      if (warnings.length > 0) {
        message += '\nWarnings:\n' + warnings.map(formatCompileMsg).join('\n');
      }
      const others = compileMessages.filter((m) => m.severity !== 'error' && m.severity !== 'warning');
      if (others.length > 0) {
        message += '\nOther:\n' + others.map(formatCompileMsg).join('\n');
      }

      return {
        content: [{ type: 'text' as const, text: message }],
        isError: errors.length > 0,
      };
    }
  );
}
