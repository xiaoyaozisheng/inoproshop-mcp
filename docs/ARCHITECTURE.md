# 架构说明（ARCHITECTURE.md）

> 适用版本：0.7.2。讲清"一条 MCP 工具调用是怎么落到 InoProShop 里的"。
> 模块速查 + 数据流 + 关键设计决策。

---

## 总览

```
MCP 客户端（Claude Code / Cursor / …）
   │  JSON-RPC over stdio（按需 spawn 子进程，非常驻服务）
   ▼
dist/bin.js ── CLI 参数解析、profile 校验（assertProfileExists）
   │
   ▼
dist/server.js ── 注册 41 个 tool + 3 个 resource
   │  每个工具 = 选脚本模板 + 填参数 + 经 ExecutorProxy 下发
   ▼
ScriptManager ── src/scripts/*.py 是 IronPython 模板
   │  interpolate() 填参（Python 转义）；prepareScriptWithHelpers()
   │  把 ensure_project_open / find_object_by_path 等辅助函数拼在正文前
   ▼
ExecutorProxy（稳定引用，内部 executor 可热切换）
   │
   ├─ persistent 模式（默认）────────────────────────────┐
   │     Launcher：spawn InoProShop.exe                  │
   │       --profile=<名> --runscript=<会话目录>/watcher.py
   │     等 ready.signal；重启后可 adopt 已有会话         │
   │     ▼                                               │
   │     IpcClient（AsyncMutex 串行化，一次一条命令）      │
   │       写 commands/<id>.py ──► watcher 轮询执行       │
   │       轮询 results/<id>.result.json（100ms→1s 退避） │
   │                                                     │
   ├─ headless 模式（--mode headless / 回退）             │
   │     每条命令写临时脚本，spawn exe --noUI <script> ───┘
   ▼
InoProShop（CODESYS V3.5 SP11 内核，ScriptEngine = IronPython 2.7）
   watcher.py：后台线程 50ms 轮询 commands/，
   经 execute_on_primary_thread 投到主线程执行（UI 保持可交互），
   结果写 results/<id>.result.json，Node 侧读后删除
```

---

## 模块速查（src/ → dist/ 一一对应）

| 模块 | 职责 |
|---|---|
| `bin.ts` | CLI 入口：commander 解析参数、`assertProfileExists()` 快速失败、`--detect` 扫描安装、组装 `ServerConfig`（含 0.7.2 的 `allowEval`） |
| `server.ts` | MCP 服务端主体：注册全部 tool/resource；`formatToolResponse` 以输出含 `SCRIPT_SUCCESS` 判成功；`decodeUriPath()` 处理资源 URI 的百分号编码（0.7.0） |
| `types.ts` | `ServerConfig` / `IpcResult` / `ScriptExecutor` 等共享类型 |
| `script-manager.ts` | 脚本模板引擎：加载 `src/scripts/*.py`、`interpolate()` 参数插值（含 Python 字符串转义）、`prepareScriptWithHelpers()` 拼接辅助函数 |
| `launcher.ts` | 拉起/接管 IDE：生成 uuid 会话目录、把 watcher.py 模板（带 `{IPC_BASE_DIR}` 插值）写到会话目录、`--runscript` 启动、等 `ready.signal`；`adopt()` 扫 `%TEMP%\codesys-mcp-persistent\` 找活会话（校验 PID 存活 + profile 匹配） |
| `ipc.ts` | 命令通道：`AsyncMutex` 保证**一次只有一条命令在途**；写 `commands/<id>.py`，轮询 `results/<id>.result.json`（100ms 起步、退避到 1s）；默认命令超时 60s、读完删结果文件 |
| `executor-proxy.ts` | 解决"启动中途换 executor"的竞态：引用稳定、`swap()` 换内核、版本戳防慢调用回写 |
| `headless.ts` | 无 UI 回退：每条命令写临时脚本，`exe --noUI <script>` 直接跑 |
| `result-parser.ts` | 解析脚本输出中的 `SCRIPT_SUCCESS` / 错误块 |
| `logger.ts` | 分级日志（全部走 **stderr**，stdout 只留给 JSON-RPC） |

**Python 侧**（`src/scripts/` → 构建时拷贝到 `dist/scripts/`，共 45 个 + `_text_utils.py` + `watcher.py`）：

- `watcher.py` —— IDE 内常驻：50ms 轮询 `commands/`，`execute_on_primary_thread` 把命令投到
  IDE 主线程（**UI 不卡死**的关键），结果写回后删命令文件；处理单条命令崩溃时写失败结果
  并删命令文件，杜绝无限重试。**改它必须重启 IDE**（`--runscript` 仅启动时载入）。
- 其余每个脚本对应一个工具，顶部定义 `__HELPERS__` 需要哪些辅助函数；
  `ensure_project_open.py` / `require_project_open.py`（后者拒绝隐式切换工程）、
  `find_object_by_path.py`、`ensure_online_connection.py`、`set_gateway_and_address` 等是公共辅助。

---

## 一条命令的完整旅程（以 `create_pou` 为例）

1. 客户端 `tools/call create_pou {...}` → server.ts 找到注册的 handler；
2. handler 调 `prepareScriptWithHelpers('create_pou', params, ['ensure_project_open', 'find_object_by_path'])`
   —— 模板里的 `{{PROJECT_FILE_PATH}}` 等占位符被 Python 转义后填入，辅助函数拼在前面；
3. `ExecutorProxy.executeScript(script)` → `IpcClient.sendCommand()`：
   - 取互斥锁（并发调用在此排队）；
   - 写 `<ipcDir>/commands/<uuid>.py`；
   - 轮询 `<ipcDir>/results/<uuid>.result.json`（100ms→1s 退避），60s 超时；
4. IDE 里的 watcher.py 50ms 内发现命令文件 → `execute_on_primary_thread` 执行 →
   写结果 JSON（`ensure_ascii=False`，中文安全）→ 删命令文件；
5. Node 读到结果、删除结果文件 → `formatToolResponse` 检查 `SCRIPT_SUCCESS` →
   包装成 MCP 响应（stdout）返回客户端。

**日志去向**：服务端日志全在 stderr；会话目录下另有 `watcher.log` / `watcher_error.txt`；
编译消息扫描另有 `%TEMP%\codesys-mcp-compile-debug.txt`。

---

## 关键设计决策（为什么是这样）

| 决策 | 原因 |
|---|---|
| 文件型 IPC 而不是 socket/COM | CODESYS ScriptEngine 只有文件 IO 和 IronPython；文件协议最可移植、可观测（命令/结果都是可检查的落盘文件） |
| watcher 后台轮询 + 主线程执行 | 直接在轮询线程跑命令会卡死 IDE UI；`execute_on_primary_thread` 让 IDE 保持可交互 |
| 互斥串行（AsyncMutex） | CODESYS 工程操作无并发语义，串行化避免竞态写坏工程 |
| ExecutorProxy 热切换 | `--no-auto-launch` 下首次调用才拉 IDE，或用户手动 `launch_codesys`；换 executor 时不能撕裂在途调用 |
| 实例接管（adopt） | MCP 客户端频繁重启（每次会话），IDE 启动要几十秒——接管让重连秒级完成 |
| ready.signal 里记 PID + profile | 接管前校验进程还活着、watcher 版本/profile 匹配，避免接错会话 |
| 模板 + 辅助函数拼接 | 一个脚本 = 一个工具，公共前置（开工程、找对象）复用，模板插值做 Python 转义防注入 |
| `SCRIPT_SUCCESS` 协议 | IronPython 异常不总能干净传回；约定"打这行字才算成功"最可靠 |
| headless 回退 | 无显示器/服务场景用 `--noUI`，代价是每命令一次进程启动 |

## 版本防回归要点

- **中文**：watcher.py 结果序列化必须 `ensure_ascii=False`（0.7.0 修复，详见 README 第六节）；
  watcher.py 自身**必须纯 ASCII**（IronPython 2.7 无编码声明拒绝非 ASCII 源码）。
- **编译消息**：`compile_project.py` / `get_compile_messages.py` 必须扫 Build 类别
  （GUID `97f48d64-…`），只信 `BUILD SUMMARY` 判据（0.7.1 修复）。
- **安全**：`eval_python` 默认禁用，`--allow-eval` 显式开启（0.7.2）。
- 测试：`npm test`（vitest，39 用例）覆盖 IPC/launcher/script-manager 单元 + 脚本模板集成；
  真机端到端用 `examples/verify-*.mjs`（需装 IDE 的机器）。
