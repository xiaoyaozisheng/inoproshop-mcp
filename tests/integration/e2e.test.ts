import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { ScriptManager } from '../../src/040_Services/FB_ScriptManager';

/**
 * Integration tests that verify the full script preparation pipeline.
 * These don't require TIA Portal but verify the template system works
 * end-to-end against the real PowerShell templates in src/090_Scripts.
 */
describe('E2E Script Preparation', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', '090_Scripts');
  const mgr = new ScriptManager(scriptsDir);

  it('open_project script prepares correctly with helpers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'open_project',
      { PROJECT_FILE_PATH: 'C:\\Projects\\Test.ap17' },
      ['ensure_project_open']
    );
    // Should contain the Ensure-ProjectOpen function
    expect(script).toContain('function Ensure-ProjectOpen');
    // Should contain the actual open logic
    expect(script).toContain('Project Opened');
    // PowerShell single-quote embedding keeps backslashes literal.
    expect(script).toContain("'C:\\Projects\\Test.ap17'");
    // Should contain success marker
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('create_pou script prepares with both helpers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'create_pou',
      {
        PROJECT_FILE_PATH: 'C:\\test.ap17',
        POU_NAME: 'MyProgram',
        POU_TYPE_STR: 'Program',
        IMPL_LANGUAGE_STR: 'ST',
        PARENT_PATH: 'Program blocks',
      },
      ['_text_utils', 'ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('function Ensure-ProjectOpen');
    expect(script).toContain('function Find-ObjectByPathRobust');
    expect(script).toContain('MyProgram');
    expect(script).toContain("'Program'");
  });

  it('set_pou_code script embeds code content via {KEY:raw}', () => {
    const declCode = 'VAR\n  x : INT;\nEND_VAR';
    const implCode = 'x := 42;';

    const script = mgr.prepareScriptWithHelpers(
      'set_pou_code',
      {
        PROJECT_FILE_PATH: 'C:\\test.ap17',
        POU_FULL_PATH: 'Program blocks/MyPOU',
        DECLARATION_CONTENT: declCode,
        IMPLEMENTATION_CONTENT: implCode,
        UPDATE_DECL: '1',
        UPDATE_IMPL: '1',
      },
      ['_text_utils', 'ensure_project_open', 'find_object_by_path']
    );
    expect(script).toContain('Program blocks/MyPOU');
    expect(script).toContain('x := 42;');
    // Newlines in the raw code block come through literally.
    expect(script).toContain('VAR\n  x : INT;\nEND_VAR');
  });

  it('check_status script has no placeholders after load', () => {
    const script = mgr.loadTemplate('check_status');
    // check_status has no {PLACEHOLDER} params
    expect(script).not.toMatch(/\{[A-Z_]+\}/);
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('compile_project script prepares with ensure_project_open', () => {
    const script = mgr.prepareScriptWithHelpers(
      'compile_project',
      { PROJECT_FILE_PATH: 'C:\\test.ap17' },
      ['_text_utils', 'ensure_project_open']
    );
    expect(script).toContain('function Ensure-ProjectOpen');
    expect(script).toContain('ICompilable');
  });

  it('watcher script has IPC placeholders', () => {
    const watcher = mgr.loadTemplate('watcher');
    expect(watcher).toContain('{IPC_BASE_DIR}');
    expect(watcher).toContain('{SCRIPTS_DIR}');
    expect(watcher).toContain('{PUBLIC_API_DLL}');
    expect(watcher).toContain('{TIA_EXE_PATH}');
  });

  it('helper scripts define all shared functions', () => {
    const textUtils = mgr.loadTemplate('_text_utils');
    expect(textUtils).toContain('function Write-Log');
    expect(textUtils).toContain('function Write-ResultJson');
    expect(textUtils).toContain('function Get-EngService');

    const ensureProject = mgr.loadTemplate('ensure_project_open');
    expect(ensureProject).toContain('function Ensure-Portal');
    expect(ensureProject).toContain('function Ensure-PlcSoftware');

    const findObject = mgr.loadTemplate('find_object_by_path');
    expect(findObject).toContain('function Find-BlockByName');
    expect(findObject).toContain('function Find-ObjectByPathRobust');

    const requireProject = mgr.loadTemplate('require_project_open');
    expect(requireProject).toContain('function Require-ProjectOpen');

    const online = mgr.loadTemplate('ensure_online_connection');
    expect(online).toContain('function Ensure-OnlineConnection');
  });

  it('all scripts are loadable and non-empty', () => {
    const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    for (const f of files) {
      const content = fs.readFileSync(path.join(scriptsDir, f), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('no leftover Python scripts in the resource layer', () => {
    const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.py'));
    expect(files).toEqual([]);
  });

  it('PowerShell scripts are ASCII-only (PS 5.1 non-BOM safety)', () => {
    const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(scriptsDir, f), 'utf-8');
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content)).toBe(true);
    }
  });
});
