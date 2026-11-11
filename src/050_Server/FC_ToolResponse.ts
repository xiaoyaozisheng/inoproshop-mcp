/**
 * FC_ToolResponse - MCP 工具响应格式化（西门子命名规范：FC_ 前缀 = Function）
 *
 * 层级：050_Server（接口层）
 */

import { IpcResult } from '../010_Core/T_Types';
import { G_SCRIPT_SUCCESS_MARKER } from '../020_Config/G_Config';

/** Format an IpcResult into an MCP tool response */
export function formatToolResponse(
  result: IpcResult,
  successMessage: string
): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
  const success = result.success && result.output.includes(G_SCRIPT_SUCCESS_MARKER);
  return {
    content: [
      {
        type: 'text' as const,
        text: success
          ? successMessage
          : `Operation failed. Output:\n${result.output}${result.error ? '\nError: ' + result.error : ''}`,
      },
    ],
    isError: !success,
  };
}
