# 架构说明（ARCHITECTURE.md）

> 适用版本：tia-portal-mcp（TIA Portal Openness 版）。
> 讲清三件事：**模块怎么分层**、**一条命令是怎么落到 TIA Portal 里的**、**为什么这样设计**。

---

## 总览

```
MCP 客户端（Claude Code / Cursor / …）
   │  JSON-RPC over stdio（客户端按需 spawn，非常驻服务）
   ▼
dist/bin.js ── CLI 参数解析（--tia-exe / --tia-version / --detect 等）
   │
   ▼
dist/050_Server/Server.js ── OB1 主入口：装配各层、注册 41 个 tool + 3 个 resource
   │
   ▼
dist/040_Services/FB_ScriptManager.js ── 装载 .ps1 模板 + {PARAM} 插值
   │                                     （helper 函数库前置拼接、PS 单引号转义）
   ▼
dist/030_Infrastructure/FB_IpcClient.js ── 写 commands/<id>.command.json + <id>.ps1，
   │                                       轮询 results/<id>.result.json
   ▼
watcher.ps1 ── 独立 powershell.exe 常驻进程（FB_TiaPortalLauncher spawn）
   │           加载 Siemens.Engineering.dll（PublicAPI 自动检测）
   │           逐条 dot-source 命令脚本；共享 $Global:TiaPortal / $Global:TiaProject
   ▼
TIA Portal ── Openness API（外部进程驱动；TIA 本体永不被 watcher 关闭）
```

## 分层与命名规范（西门子模板风格）

目录按编号分层，禁止跨层反向依赖（`010 → 020 → 030 → 040 → 050`，高层可依赖低层）：

| 层 | 目录 | 内容 | 命名前缀 |
|---|---|---|---|
| 核心层 | `010_Core/` | 共享类型、日志、路径/编码工具 | `T_`（类型）、`FC_`（纯函数） |
| 配置层 | `020_Config/` | 全局参数表 G_Config | `G_`（全局量） |
| 基础设施层 | `030_Infrastructure/` | IPC 客户端、watcher 启动器、headless 执行器 | `FB_`（有状态块） |
| 服务层 | `040_Services/` | 脚本模板引擎、executor 代理、结果解析 | `FB_` / `FC_` |
| 接口层 | `050_Server/` | MCP Server 主入口 + 按功能区的工具注册 | `FC_` + `T_` |
| 资源层 | `090_Scripts/` | 46 个 PowerShell 脚本（构建时拷入 dist） | PowerShell 动词命名 |

### 模块速查（src/ → dist/ 一一对应）

| 模块 | 职责 |
|---|---|
| `bin.ts` | CLI 入口：commander 解析参数、`--detect` 扫描 `C:\Program Files\Siemens\Automation\Portal V*`（exe + PublicAPI dll 双探测）、组装 `ServerConfig` |
| `050_Server/Server.ts` | MCP 服务端主入口（OB1）：装配各层、按功能区注册 tool/resource、stdio 连接、watcher 自动启动/收养、优雅退出（shutdown 只停 watcher） |
| `010_Core/T_Types.ts` | `ServerConfig` / `IpcResult` / `ScriptExecutor` / `TiaState` 等共享类型 |
| `020_Config/G_Config.ts` | 集中参数表：IPC 轮询/退避、命令超时、协议标记（`SCRIPT_SUCCESS` / `SCRIPT_ERROR`）、会话目录前缀（`tia-mcp-persistent`）、脚本扩展名（`.ps1`） |
| `040_Services/FB_ScriptManager.ts` | 脚本模板引擎：装载 `src/090_Scripts/*.ps1`、`interpolate()` 参数插值（PowerShell 单引号转义：`'` → `''`）、`prepareScriptWithHelpers()` 前置拼接 helper 函数库 |
| `030_Infrastructure/FB_TiaPortalLauncher.ts` | watcher 进程管理：spawn `powershell.exe -File watcher.ps1`、插值 IPC 目录/脚本目录/PublicAPI 路径、会话收养（adopt 存活会话，避免重复拉起）、健康监测 |
| `030_Infrastructure/FB_IpcClient.ts` | 命令通道：`AsyncMutex` 保证一次只有一条命令在途；写命令文件，轮询结果（100ms 起步、退避到 1s）；读完删结果文件 |
| `030_Infrastructure/FB_HeadlessExecutor.ts` | 无 UI 回退：headless_bootstrap + 命令脚本合成临时 .ps1，`powershell.exe -File` 直接跑（每命令一个进程，无共享状态） |
| `040_Services/FB_ExecutorProxy.ts` | 解决"启动中途换 executor"的竞态：引用稳定、`swap()` 换内核、版本戳防慢调用回写旧 executor |
| `040_Services/FC_ResultParser.ts` | 解析脚本输出：`SCRIPT_SUCCESS` 判成功、`SCRIPT_ERROR:` 提取错误、`### RESULT_JSON ###` 围栏取结构化数据 |
| `010_Core/FC_Logger.ts` | 分级日志（全部走 **stderr**，stdout 只留给 JSON-RPC） |

### 工具注册模块（050_Server/）

| 模块 | 工具数 | 覆盖 |
|---|---|---|
| `FC_RegisterManagementTools.ts` | 4 | launch_tia / shutdown_tia / get_tia_status / eval_powershell（门控） |
| `FC_RegisterProjectTools.ts` | 4 | create_project / open_project / save_project / list_project_templates |
| `FC_RegisterPouTools.ts` | 6 | create_pou / set_pou_code / get_pou_code / get_all_pou_code / compile_project / get_compile_messages |
| `FC_RegisterStructureTools.ts` | 7 | create_folder / create_dut / create_gvl / delete_object / rename_object / search_code / rename_symbol |
| `FC_RegisterRuntimeTools.ts` | 9 | connect / disconnect / credentials / simulation / download / read+write variable / monitor / start_stop |
| `FC_RegisterLibraryTools.ts` | 11 | 库管理、设备节点、IO、归档、method/property（部分为 Openness 限制诊断） |
| `FC_RegisterResources.ts` | 3 resource | `tia://project/status`、`tia://project/{+project_path}/structure`、`tia://project/{+project_path}/pou/{+pou_path}/code` |

## 文件 IPC 协议

协议与目标 IDE 解耦（这是原项目最核心的设计），watcher 换语言/平台时 Node 侧不用改。

### 会话目录

```
%TEMP%/tia-mcp-persistent/<uuid>/
  ├── commands/<id>.command.json    命令信封（元数据）
  ├── commands/<id>.ps1             完整命令脚本（helper 前置 + 参数已转义）
  ├── results/<id>.result.json      结果（Node 读完即删）
  ├── ready.signal                  watcher 进程就绪（≠ TIA 已挂接）
  └── terminate.signal              请求 watcher 退出（只停 watcher）
```

### 命令信封（command.json）

```json
{ "id": "<uuid>", "script": "<id>.ps1", "createdAt": "<iso>" }
```

### 结果（result.json）

```json
{
  "id": "<uuid>",
  "success": true,
  "output": "SCRIPT_SUCCESS: ...\n### RESULT_JSON ###\n{ ... }\n### END_RESULT_JSON ###",
  "error": null,
  "durationMs": 1234
}
```

- 成功判据：`output` 含 `SCRIPT_SUCCESS` 标记（`G_Config` 集中定义）。
- 结构化数据：`### RESULT_JSON ### … ### END_RESULT_JSON ###` 围栏内的 JSON，
  由 `FC_ResultParser.parseResultJson()` 提取；PowerShell 端用 JavaScriptSerializer
  序列化（`ConvertTo-Json` 会把单元素数组吞成对象，破坏协议）。

## PowerShell 资源层（src/090_Scripts/ → dist/090_Scripts/，共 46 个）

| 类别 | 文件 | 说明 |
|---|---|---|
| watcher | `watcher.ps1` | 常驻 IPC 守护：加载 Openness dll → 写 ready.signal → 轮询 commands → dot-source 执行 → 写 results；terminate.signal 退出。命令在**同一 Runspace** 中执行，`$Global:TiaPortal` / `$Global:TiaProject` 跨命令共享 |
| bootstrap | `headless_bootstrap.ps1` | headless 模式前导（dll 加载 + helper 预载） |
| helper | `_text_utils.ps1` | Write-Log 输出缓冲、Write-ResultJson（JavaScriptSerializer）、Get-EngService（GetService\<T\> 反射）、块 XML 导出/导入、SCL 往返、编译消息扁平化、Write-Utf8BomFile |
| helper | `ensure_project_open.ps1` | Ensure-Portal（挂接/启动 TIA）、Ensure-ProjectOpen、Ensure-PlcSoftware（定位 PlcSoftware 容器）、Save-ProjectQuiet |
| helper | `require_project_open.ps1` | 严格版：不隐式打开工程（resource 用，防止 URI 与已开工程错位） |
| helper | `find_object_by_path.ps1` | Find-BlockByName / Find-TypeByName / Find-DeviceByName / Find-ObjectByPathRobust |
| helper | `ensure_online_connection.ps1` | 记录连接目标（Openness 无在线会话 API，仅诊断用） |
| 命令脚本 | 39 个 `.ps1` | 与 41 个 tool 一一对应（部分 tool 共享脚本/在 Node 侧组装） |

全部脚本 **ASCII-only**（规避 PS 5.1 无 BOM 乱码风险），并纳入单测做语法 + 编码校验。

## 一条命令的完整旅程（create_pou）

1. 客户端 `tools/call create_pou {...}` → `FC_RegisterPouTools` 找到注册的 handler；
2. handler 校验参数 → `resolvePath()` 相对路径转绝对 → `sanitizePouPath()`；
3. `scriptManager.prepareScriptWithHelpers('create_pou', {...}, ['_text_utils','ensure_project_open','find_object_by_path'])`
   生成完整 PowerShell 源（helper 在前、参数已单引号转义）；
4. `executor.executeScript(script)`（ExecutorProxy → 当前模式的执行器）；
5. FB_IpcClient 写 `commands/<uuid>.ps1` + `.command.json`；
6. watcher.ps1 拾取 → dot-source 执行：Ensure-Portal → Ensure-PlcSoftware →
   写临时 .scl（UTF-8 BOM）→ `ExternalSources.CreateFromFile` →
   `GenerateBlocksFromSource`（反射兼容 V17/V21 两代方法名）→ 保存工程 →
   `Write-Log "SCRIPT_SUCCESS: ..."`；
7. watcher 写 `results/<uuid>.result.json`，Node 侧轮询到后读取并删除结果文件；
8. `formatToolResponse` 以 `SCRIPT_SUCCESS` 判成功 → 返回 MCP 响应。

## 关键设计决策

- **为什么换掉 IronPython？** TIA Portal 没有 CODESYS 式的 IDE 内脚本引擎；
  Openness 是外部 .NET API，PowerShell 是零依赖、Windows 自带的驱动方式，
  且 `.NET` 对象在 PS 里可直接操作，无需编译 C# 辅助程序集。
- **为什么保留文件 IPC 协议不变？** 协议与 IDE 解耦（原项目的核心设计）。
  watcher 从 Python 换成 PowerShell、目标从 CODESYS 换成 TIA Portal 时，
  Node 侧、工具契约与测试结构可以原样保留，回归风险最小。
- **为什么 watcher 写完 ready.signal 才挂接 TIA？** 挂接/启动 TIA 可能触发
  Openness 防火墙确认框甚至冷启动数分钟；ready.signal 只表示"watcher 进程活着"，
  MCP 握手立即完成；TIA 挂接在第一条工程命令时惰性执行。
- **为什么块生成走 SCL 外部源而不是直接改 XML？** Openness 官方支持的文本生成
  通道就是 ExternalSources → GenerateBlocksFromSource；直接注入块 XML 依赖未公开
  格式、版本脆弱。set_pou_code 先导出既有块 XML 保留接口，再整体重建，避免半块状态。
- **为什么下载前强制先编译？** Openness 下载 API 要求块一致性（已编译），
  编译错误会让下载半途而废，提前失败能给出更清晰的诊断。
- **为什么在线类工具返回结构化诊断而不是删除？** 保持 41 个 tool 的契约稳定；
  诚实的"不支持 + 替代方案"（OPC UA / snap7 / TIA UI）优于静默失败或伪造成功。
- **为什么 shutdown 永不关闭 TIA Portal？** TIA 本体可能承载用户手工编辑的未保存
  工程；watcher 只是 MCP 的执行代理，无权处置用户的 IDE。
