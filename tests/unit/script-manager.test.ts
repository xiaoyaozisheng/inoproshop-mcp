import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/040_Services/FB_ScriptManager';

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'src', '090_Scripts');

describe('ScriptManager', () => {
  const mgr = new ScriptManager(SCRIPTS_DIR);

  it('loads an existing template', () => {
    const content = mgr.loadTemplate('check_status');
    expect(content).toContain('TIA Portal');
    expect(content).toContain('SCRIPT_SUCCESS');
  });

  it('throws for non-existent template', () => {
    expect(() => mgr.loadTemplate('nonexistent_script')).toThrow(/not found/);
  });

  it('interpolates a single param', () => {
    const result = mgr.interpolate('hello {FOO}', { FOO: 'bar' });
    expect(result).toBe('hello bar');
  });

  it('leaves backslashes untouched (PS single-quoted literals are raw)', () => {
    const result = mgr.interpolate("path = '{PATH}'", {
      PATH: 'C:\\Users\\Test',
    });
    expect(result).toBe("path = 'C:\\Users\\Test'");
  });

  it('doubles single quotes (PowerShell escaping)', () => {
    const result = mgr.interpolate("s = '{S}'", { S: "it's" });
    expect(result).toBe("s = 'it''s'");
  });

  it('leaves newlines literal (valid inside PS single-quoted strings)', () => {
    const result = mgr.interpolate("s = '{S}'", { S: 'line1\nline2' });
    expect(result).toBe("s = 'line1\nline2'");
  });

  it('{KEY:raw} bypasses escaping for code-block embedding', () => {
    const result = mgr.interpolate('code = {C:raw}', { C: 'Write-Log "hi"' });
    expect(result).toBe('code = Write-Log "hi"');
  });

  it('does not interpret $ in value as a regex backref', () => {
    const result = mgr.interpolate("s = '{S}'", { S: '$&' });
    expect(result).toBe("s = '$&'");
  });

  it('interpolates multiple params', () => {
    const result = mgr.interpolate('{A} and {B}', { A: 'x', B: 'y' });
    expect(result).toBe('x and y');
  });

  it('two reads of the same template return identical content', () => {
    const first = mgr.loadTemplate('check_status');
    const second = mgr.loadTemplate('check_status');
    expect(first).toEqual(second);
  });

  it('combineScripts concatenates with double newlines', () => {
    const result = mgr.combineScripts('script1', 'script2', 'script3');
    expect(result).toBe('script1\n\nscript2\n\nscript3');
  });

  it('prepareScript loads and interpolates with raw Windows paths', () => {
    const result = mgr.prepareScript('create_project', {
      PROJECT_FILE_PATH: 'C:\\Projects\\MyProject',
    });
    // PowerShell single-quote embedding keeps backslashes as written.
    expect(result).toContain("'{PROJECT...}'".replace('{PROJECT...}', 'C:\\Projects\\MyProject'));
  });

  it('prepareScriptWithHelpers prepends helpers', () => {
    const result = mgr.prepareScriptWithHelpers(
      'open_project',
      { PROJECT_FILE_PATH: 'C:\\test.ap17' },
      ['ensure_project_open']
    );
    // ensure_project_open function should appear before open_project body
    const ensureIdx = result.indexOf('function Ensure-ProjectOpen');
    const openIdx = result.indexOf('Project Opened');
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(-1);
    expect(ensureIdx).toBeLessThan(openIdx);
  });

  it('Windows path with spaces passes through correctly', () => {
    const result = mgr.interpolate("path = '{PATH}'", {
      PATH: 'C:\\Program Files\\Siemens\\Automation',
    });
    // Backslashes unchanged, spaces unchanged.
    expect(result).toBe("path = 'C:\\Program Files\\Siemens\\Automation'");
  });
});
