/**
 * T_ToolContext - MCP 工具注册上下文（西门子命名规范：T_ 前缀 = Type）
 *
 * Server.ts 组装好运行时依赖后，通过本上下文对象传递给各功能区的
 * 注册模块（050_Server/FC_Register*Tools.ts），使"OB1（Server 主流程）→
 * 按功能区调用的注册块"的代码组织方式成立。
 *
 * 层级：050_Server（接口层）
 */

import { ServerConfig, ExecutionMode } from '../010_Core/T_Types';
import { TiaPortalLauncher } from '../030_Infrastructure/FB_TiaPortalLauncher';
import { ScriptManager } from '../040_Services/FB_ScriptManager';
import { ExecutorProxy } from '../040_Services/FB_ExecutorProxy';

export interface ToolContext {
  /** 完整服务端配置（CLI/环境变量解析结果） */
  config: ServerConfig;
  /** PowerShell 脚本模板管理器（090_Scripts 资源） */
  scriptManager: ScriptManager;
  /** 持久模式启动器；headless-only 时为 null */
  launcher: TiaPortalLauncher | null;
  /** 稳定的执行器代理（所有工具统一经它执行脚本） */
  executor: ExecutorProxy;
  /**
   * 当前执行模式。可变属性：Management 注册块与后台自动启动会更新它，
   * get_tia_status 读取它。
   */
  executionMode: ExecutionMode;
  /** 相对工程路径的解析基准目录 */
  workspaceDir: string;
}
