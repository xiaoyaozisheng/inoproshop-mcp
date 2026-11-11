/**
 * T_Types - 全局共享类型定义（西门子命名规范：T_ 前缀 = Type/结构类型）
 *
 * 层级：010_Core（核心层，不依赖任何其他层）
 *
 * 目标平台：Siemens TIA Portal（TIA Portal Openness API）。
 */

export type RequestId = string;
export type SessionId = string;

/** Command file written by Node.js to commands/ directory */
export interface IpcCommand {
  requestId: RequestId;
  scriptPath: string;
  timestamp: number;
}

/** Result file written by watcher to results/ directory */
export interface IpcResult {
  requestId: RequestId;
  success: boolean;
  output: string;
  error: string;
  timestamp: number;
}

/** TIA Portal watcher process lifecycle state */
export type TiaState = 'stopped' | 'launching' | 'ready' | 'stopping' | 'error';

/**
 * Configuration for launching the TIA Portal MCP watcher.
 *
 * tiaExePath may be empty: the PowerShell watcher can start TIA Portal via
 * TiaPortal Openness itself (`new TiaPortal(WithUserInterface)`), so the exe
 * path is only required for pre-launch kill / diagnostics.
 */
export interface LauncherConfig {
  /** Path to TIA Portal executable (Siemens.Automation.Portal.exe). May be '' to auto-attach. */
  tiaExePath: string;
  /** TIA Portal version identifier, e.g. "V17" — selects the PublicAPI folder when auto-detecting. */
  tiaVersion: string;
  workspaceDir: string;
  /**
   * If true, runs `taskkill /F /T /IM Siemens.Automation.Portal.exe` before
   * spawning a new watcher. Useful in dev when MCP server restarts leave
   * orphaned TIA instances holding project locks. Off by default — never
   * kill an external TIA Portal instance the user might be using.
   */
  killExistingTia?: boolean;
}

/** Runtime status of the TIA Portal launcher */
export interface LauncherStatus {
  state: TiaState;
  pid: number | null;
  sessionId: SessionId | null;
  ipcDir: string | null;
  startedAt: number | null;
  lastError: string | null;
}

/** IPC transport configuration */
export interface IpcConfig {
  baseDir: string;
  commandTimeoutMs: number;
  pollIntervalMs: number;
  maxPollIntervalMs: number;
  deleteResultAfterRead: boolean;
}

/** Full server configuration */
export interface ServerConfig extends LauncherConfig {
  autoLaunch: boolean;
  keepAlive: boolean;
  timeoutMs: number;
  fallbackHeadless: boolean;
  verbose: boolean;
  debug: boolean;
  mode: ExecutionMode;
  /** Register the eval_powershell tool (arbitrary PowerShell execution). Off by default. */
  allowEval: boolean;
}

/** Script template parameters */
export type ScriptParams = Record<string, string>;

/** Execution mode */
export type ExecutionMode = 'persistent' | 'headless';

/** Interface for script executors (both persistent and headless) */
export interface ScriptExecutor {
  executeScript(content: string, timeoutMs?: number): Promise<IpcResult>;
}
