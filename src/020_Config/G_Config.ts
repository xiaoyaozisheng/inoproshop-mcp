/**
 * G_Config - 全局集中配置（西门子命名规范：G_ 前缀 = Global，全局常量/参数表）
 *
 * 对应西门子模板项目中"全局数据区（Global Constants）统一管理参数"的配置方式。
 *
 * 层级：020_Config（配置层，只依赖 010_Core 或无依赖）
 */

import { IpcConfig } from '../010_Core/T_Types';

// ─── IPC 默认参数 ─────────────────────────────────────────────────────

/** Default IPC configuration */
export const G_DEFAULT_IPC_CONFIG: Omit<IpcConfig, 'baseDir'> = {
  commandTimeoutMs: 60_000,
  pollIntervalMs: 100,
  maxPollIntervalMs: 1_000,
  deleteResultAfterRead: true,
};

// ─── 脚本执行结果标记（Node 侧判定脚本成败的协议） ─────────────────────

export const G_SCRIPT_SUCCESS_MARKER = 'SCRIPT_SUCCESS';
export const G_SCRIPT_ERROR_MARKER = 'SCRIPT_ERROR';

/** 命令脚本扩展名（TIA 方案使用 PowerShell） */
export const G_SCRIPT_EXTENSION = '.ps1';

// ─── Launcher（watcher 进程管理）参数 ──────────────────────────────────

/** %TEMP% 下会话目录名前缀 */
export const G_SESSION_DIR_PREFIX = 'tia-mcp-persistent';

// Cold start of TIA Portal (with Openness firewall prompt and project loading)
// can take several minutes. Override via TIA_MCP_READY_TIMEOUT_MS.
export const G_READY_TIMEOUT_MS = Number(process.env.TIA_MCP_READY_TIMEOUT_MS) > 0
  ? Number(process.env.TIA_MCP_READY_TIMEOUT_MS)
  : 300_000;

export const G_READY_POLL_MS = 500;
export const G_SHUTDOWN_WAIT_MS = 10_000;
export const G_HEALTH_CHECK_INTERVAL_MS = 5_000;

// ─── Headless 执行器参数 ───────────────────────────────────────────────

export const G_HEADLESS_DEFAULT_TIMEOUT_MS = 60_000;

// ─── 工具级默认超时（毫秒） ────────────────────────────────────────────

/** eval_powershell 默认超时 */
export const G_EVAL_DEFAULT_TIMEOUT_MS = 30_000;
/** 编译/全量读代码/搜索/重命名等重操作超时 */
export const G_HEAVY_OP_TIMEOUT_MS = 120_000;
/** 在线连接/设备库枚举/模板枚举等中操作超时 */
export const G_ONLINE_OP_TIMEOUT_MS = 60_000;
/** monitor_variables 最长采样时长（脚本侧同步封顶） */
export const G_MONITOR_MAX_DURATION_MS = 60_000;
/** monitor_variables 最短采样间隔 */
export const G_MONITOR_MIN_INTERVAL_MS = 10;
