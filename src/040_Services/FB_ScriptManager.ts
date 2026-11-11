/**
 * FB_ScriptManager - PowerShell 脚本模板装载与插值（西门子命名规范：FB_ 前缀 = Function Block）
 *
 * Loads .ps1 templates from src/090_Scripts/ and performs {PARAM} replacement.
 *
 * 层级：040_Services（服务层：脚本模板、执行代理、结果解析）
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScriptParams } from '../010_Core/T_Types';

/**
 * Escape a string for safe embedding inside a PowerShell single-quoted
 * string literal. In PowerShell the only special character in a
 * single-quoted string is the single quote itself, which is doubled.
 * Newlines stay literal (valid inside single-quoted literals), so multi-line
 * values (user code blocks, paths) survive the round trip untouched.
 */
function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

export class ScriptManager {
  private scriptsDir: string;

  constructor(scriptsDir?: string) {
    // 默认目录：编译产物 dist/090_Scripts（构建时由 package.json 的 build
    // 脚本从 src/090_Scripts 原样拷贝）。__dirname 位于 dist/040_Services，
    // 上一层即 dist 根。
    this.scriptsDir = scriptsDir ?? path.join(__dirname, '..', '090_Scripts');
  }

  /** Load a template file from disk. */
  loadTemplate(name: string): string {
    const fileName = name.endsWith('.ps1') ? name : `${name}.ps1`;
    const filePath = path.join(this.scriptsDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Script template not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Replace {KEY} placeholders with PowerShell-escaped values.
   *
   * Every value is escaped for safe embedding inside a PowerShell
   * single-quoted string literal (the single quote is doubled). This
   * eliminates injection bugs where a user-controlled identifier (POU name,
   * variable path, password) could contain a quote that broke out of the
   * string literal in the generated PowerShell source.
   *
   * For values that must be embedded outside a string (raw code blocks like
   * `set_pou_code` declaration/implementation), use `{KEY:raw}` in the
   * template — those placeholders skip escaping.
   *
   * The replace callback form is used so a `$` in the value isn't
   * interpreted as a regex backreference token.
   */
  interpolate(template: string, params: ScriptParams): string {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
      const escaped = psEscape(String(value));
      const escapedPattern = new RegExp(`\\{${key}\\}`, 'g');
      const rawPattern = new RegExp(`\\{${key}:raw\\}`, 'g');
      result = result.replace(rawPattern, () => String(value));
      result = result.replace(escapedPattern, () => escaped);
    }
    return result;
  }

  /** Concatenate multiple script fragments with double newlines */
  combineScripts(...scripts: string[]): string {
    return scripts.join('\n\n');
  }

  /** Load a template and interpolate parameters */
  prepareScript(name: string, params: ScriptParams): string {
    const template = this.loadTemplate(name);
    return this.interpolate(template, params);
  }

  /** Prepend helper scripts before the main script, then interpolate all */
  prepareScriptWithHelpers(
    name: string,
    params: ScriptParams,
    helpers: string[]
  ): string {
    const helperContents = helpers.map((h) => this.loadTemplate(h));
    const mainTemplate = this.loadTemplate(name);
    const combined = this.combineScripts(...helperContents, mainTemplate);
    return this.interpolate(combined, params);
  }
}
