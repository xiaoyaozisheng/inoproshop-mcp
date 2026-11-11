/**
 * Server - MCP 服务主入口（对应西门子模板的 OB1 主组织块）
 *
 * 组装各层并按功能区调用工具注册模块：
 *   - 010_Core / 020_Config / 030_Infrastructure / 040_Services 的实例装配
 *   - 050_Server/FC_Register*Tools.ts 按功能区注册 41 个 tool
 *   - 050_Server/FC_RegisterResources.ts 注册 3 个 resource
 *   - stdio 连接、后台自动启动、优雅退出
 *
 * Supports persistent (watcher-based) and headless (spawn-per-command) modes.
 */

import * as fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ServerConfig, ExecutionMode, ScriptExecutor } from '../010_Core/T_Types';
import { TiaPortalLauncher } from '../030_Infrastructure/FB_TiaPortalLauncher';
import { HeadlessExecutor } from '../030_Infrastructure/FB_HeadlessExecutor';
import { ScriptManager } from '../040_Services/FB_ScriptManager';
import { ExecutorProxy } from '../040_Services/FB_ExecutorProxy';
import { serverLog, setLogLevel } from '../010_Core/FC_Logger';
import { ToolContext } from './T_ToolContext';
import { registerManagementTools } from './FC_RegisterManagementTools';
import { registerProjectTools } from './FC_RegisterProjectTools';
import { registerPouTools } from './FC_RegisterPouTools';
import { registerStructureTools } from './FC_RegisterStructureTools';
import { registerRuntimeTools } from './FC_RegisterRuntimeTools';
import { registerLibraryTools } from './FC_RegisterLibraryTools';
import { registerResources } from './FC_RegisterResources';

let SERVER_VERSION = '0.0.0';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SERVER_VERSION = require('../../package.json').version;
} catch {
  // package.json not found at runtime; fall through with the placeholder.
}

export async function startMcpServer(config: ServerConfig): Promise<void> {
  // Set log level
  if (config.debug) setLogLevel('debug');
  else if (config.verbose) setLogLevel('info');

  serverLog.info(`Starting TIA Portal Persistent MCP Server v${SERVER_VERSION}`);
  serverLog.info(`Mode: ${config.mode}`);
  serverLog.info(`TIA Portal exe: ${config.tiaExePath || '(auto — Openness will attach/start TIA)'}`);
  serverLog.info(`TIA version hint: ${config.tiaVersion || '(auto-detect)'}`);
  serverLog.info(`Workspace: ${config.workspaceDir}`);
  serverLog.info(`eval_powershell: ${config.allowEval ? 'enabled' : 'disabled (start with --allow-eval to enable)'}`);

  // Validate TIA exe path when explicitly provided (optional — the watcher
  // can start TIA Portal through Openness without knowing the exe path).
  if (config.tiaExePath && !fs.existsSync(config.tiaExePath)) {
    throw new Error(`TIA Portal executable not found: ${config.tiaExePath}`);
  }

  // Initialize executor based on mode.
  //
  // IMPORTANT: We do NOT await launcher.launch() here. TIA Portal watcher startup
  // takes ~30s, but the MCP `initialize` handshake from Claude Code times out long
  // before that — making the server look "Failed to connect" while a zombie process
  // process stays running. Instead we register tools, connect the stdio transport
  // immediately (so the handshake answers in milliseconds), then kick the launch
  // off in the background and swap the executor reference once it's ready.
  // Stable proxy reference. Tool handlers capture `executor` once (it's a
  // const) and never see the inner swap directly - the proxy gates every
  // executeScript on a readiness promise that's atomically updated whenever
  // the inner executor changes (see FB_ExecutorProxy.ts for the contract).
  let launcher: TiaPortalLauncher | null = null;
  const initialExecutor: ScriptExecutor = new HeadlessExecutor(config);
  const executor = new ExecutorProxy(initialExecutor);
  const executionMode: { value: ExecutionMode } = { value: config.mode };

  if (config.mode === 'persistent') {
    launcher = new TiaPortalLauncher(config);
    // Start in headless mode; we'll swap to the persistent launcher once it's
    // ready (see "Background auto-launch" block below).
    executionMode.value = 'headless';
  }

  const scriptManager = new ScriptManager();
  const workspaceDir = config.workspaceDir;

  // Create MCP server
  const server = new McpServer(
    {
      name: 'TIA Portal Persistent MCP Server',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        resources: { listChanged: true },
        tools: { listChanged: true },
      },
    }
  );

  // Note: using 'as any' cast on server for tool() calls to work around
  // TS2589 deep type instantiation with MCP SDK generics + Zod.
  const s = server as any;

  // 组装工具注册上下文，按功能区注册（对应西门子模板"按功能区分层组织"）
  const ctx: ToolContext = {
    config,
    scriptManager,
    launcher,
    executor,
    // 用 getter/setter 让注册模块可以读写执行模式（原实现为闭包内 let 变量）
    get executionMode() {
      return executionMode.value;
    },
    set executionMode(mode: ExecutionMode) {
      executionMode.value = mode;
    },
    workspaceDir,
  };

  // ─── 按功能区注册 41 个 tool ─────────────────────────────────────────
  registerManagementTools(s, ctx); // 管理：启动/停止/状态/eval
  registerProjectTools(s, ctx);    // 工程：打开/新建/模板/保存
  registerPouTools(s, ctx);        // POU：POU/属性/方法/编译
  registerStructureTools(s, ctx);  // 结构：DUT/GVL/文件夹/对象增删改查/搜索
  registerRuntimeTools(s, ctx);    // 在线：连接/凭据/仿真/变量读写/下载/启停
  registerLibraryTools(s, ctx);    // 库与设备：库/设备仓库/IO/参数/符号/监视/归档

  // ─── 注册 3 个只读 resource ──────────────────────────────────────────
  registerResources(server, ctx);

  // ─── Connect ─────────────────────────────────────────────────────────
  // Connect transport BEFORE auto-launching the watcher so the MCP `initialize`
  // handshake answers immediately (Claude Code's probe times out fast).

  const transport = new StdioServerTransport();
  serverLog.info('Connecting MCP server via stdio...');
  await server.connect(transport);
  serverLog.info('MCP Server connected and listening.');

  // ─── Background auto-launch (do not await) ───────────────────────────

  if (launcher && config.autoLaunch) {
    const persistentLauncher = launcher;
    serverLog.info('Auto-launching the TIA Portal watcher in the background...');
    // Hand the proxy a readiness promise so tool calls during the launch
    // window block on it before delegating - no race between swap and
    // mid-flight executeScript calls.
    const launchReady = persistentLauncher.launch().then(
      () => {
        ctx.executionMode = 'persistent';
        serverLog.info('TIA Portal persistent instance ready; executor switched.');
      },
      (err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        serverLog.error(`Persistent launch failed: ${errMsg}`);
        if (config.fallbackHeadless) {
          serverLog.warn('Continuing in headless mode (fallback).');
        } else {
          serverLog.error(
            'No fallback configured; tool calls will keep using headless executor.'
          );
        }
        // Re-throw so the proxy keeps the headless executor.
        throw err;
      }
    );
    executor.swap(persistentLauncher, launchReady);
  }

  // ─── Graceful Shutdown ───────────────────────────────────────────────

  const shutdown = async () => {
    serverLog.info('Shutdown signal received');
    if (launcher) {
      try {
        await launcher.shutdown();
      } catch {
        serverLog.warn('Launcher shutdown failed during signal handler');
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (reason) => {
    serverLog.error(`Unhandled rejection: ${reason}`);
  });
}
