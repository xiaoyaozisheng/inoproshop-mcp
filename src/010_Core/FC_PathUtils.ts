/**
 * FC_PathUtils - 路径与文件系统通用纯函数（西门子命名规范：FC_ 前缀 = Function）
 *
 * 从 server.ts 提取的通用工具函数，供 050_Server 各注册模块复用。
 * 层级：010_Core（核心层，不依赖其他层）
 */

import * as fs from 'fs';
import * as path from 'path';

/** Resolve a file path to an absolute normalized path */
export function resolvePath(filePath: string, workspaceDir: string): string {
  return path.normalize(
    path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath)
  );
}

/** Sanitize a POU path (forward slashes, no leading/trailing slashes) */
export function sanitizePouPath(pouPath: string): string {
  return pouPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Decode a path captured from a resource URI template.
 *
 * Clients disagree on how to build a `codesys://project/{+project_path}/...`
 * URI: some percent-encode the path (so `项目` arrives as `%E9%A1%B9%E7%9B%AE`),
 * others pass it through raw. The MCP SDK does not decode for us, so without
 * this the platform path never matches the open project and the read-only
 * handlers refuse to serve it ("not the currently-open one"). Decode only when
 * the value actually looks percent-encoded, and fall back to the original if
 * decoding fails, so paths containing a literal '%' keep working.
 */
export function decodeUriPath(value: string): string {
  if (!value || value.indexOf('%') === -1) return value;
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Check if a file exists (async) */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}
