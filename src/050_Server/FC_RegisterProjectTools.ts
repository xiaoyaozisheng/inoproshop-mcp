/**
 * FC_RegisterProjectTools - 工程类工具注册（西门子命名规范：FC_ 前缀 = Function）
 *
 * 注册 4 个工程工具：open_project / create_project /
 * list_project_templates / save_project。对应原 server.ts
 * "Project Tools" 分节，逻辑不变。
 *
 * 层级：050_Server（接口层）
 */

import * as path from 'path';
import { z } from 'zod';
import { ToolContext } from './T_ToolContext';
import { formatToolResponse } from './FC_ToolResponse';
import { resolvePath, fileExists } from '../010_Core/FC_PathUtils';
import { parseResultJson } from '../040_Services/FC_ResultParser';

export function registerProjectTools(s: any, ctx: ToolContext): void {
  const { config, scriptManager, executor, workspaceDir } = ctx;

  s.tool(
    'open_project',
    'Opens an existing TIA Portal project file.',
    {
      filePath: z.string().describe("Path to the project file (e.g., 'C:/Projects/MyPLC.project')."),
    },
    async (args: { filePath: string }) => {
      const escaped = resolvePath(args.filePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'open_project', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(result, `Project opened: ${args.filePath}`);
    }
  );

  s.tool(
    'create_project',
    'Create a new TIA Portal project at the given path. TIA projects are created from scratch (Openness Projects.Create); add a PLC station with the TIA UI or AML import afterwards.',
    {
      filePath: z.string().describe("Path where the new project should be created (project name is derived from the file name)."),
    },
    async (args: { filePath: string }) => {
      const absPath = path.normalize(
        path.isAbsolute(args.filePath) ? args.filePath : path.join(workspaceDir, args.filePath)
      );

      const script = scriptManager.prepareScript('create_project', {
        PROJECT_FILE_PATH: absPath,
      });
      const result = await executor.executeScript(script);
      return formatToolResponse(result, `Project created: ${absPath}`);
    }
  );

  s.tool(
    'list_project_templates',
    "List project templates found on disk (TIA Portal has no template registry API). Scans the well-known Siemens template folders under ProgramData / Public / user Documents. Returns {name, path, source} per template; pass `name` to create_project(templateName=...) or `path` to create_project(templatePath=...).",
    {
      extraTemplateDir: z.string().optional().describe("Optional additional directory to scan for .project / .projecttemplate files."),
    },
    async (args: { extraTemplateDir?: string }) => {
      const script = scriptManager.prepareScriptWithHelpers(
        'list_project_templates',
        { EXTRA_TEMPLATE_DIR: args.extraTemplateDir ?? '' },
        ['_text_utils']
      );
      const result = await executor.executeScript(script, 60_000);
      const success = result.success && result.output.includes('SCRIPT_SUCCESS');
      if (!success) return formatToolResponse(result, '');
      const parsed = parseResultJson<{
        templates: Array<{ name: string | null; path: string | null; source: string }>;
        count: number;
        api_attempts: string[];
        filesystem_hits: number;
      }>(result.output);
      if (!parsed.ok) return formatToolResponse(result, '');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed.data, null, 2) }],
        isError: false,
      };
    }
  );

  s.tool(
    'save_project',
    'Saves the currently open TIA Portal project.',
    {
      projectFilePath: z.string().describe("Path to the project file to ensure is open before saving."),
    },
    async (args: { projectFilePath: string }) => {
      const escaped = resolvePath(args.projectFilePath, workspaceDir);
      const script = scriptManager.prepareScriptWithHelpers(
        'save_project', { PROJECT_FILE_PATH: escaped }, ['_text_utils', 'ensure_project_open']
      );
      const result = await executor.executeScript(script);
      return formatToolResponse(result, `Project saved: ${args.projectFilePath}`);
    }
  );
}
