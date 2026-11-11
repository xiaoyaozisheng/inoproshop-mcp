# TIA Portal MCP —— 西门子 SIMATIC PLC 程序化编程接口

**简体中文** | [English](README.en.md)

`tia-portal-mcp` 是一个 MCP（Model Context Protocol）服务器，让 AI 客户端（Claude Code、Cursor 等）能够**程序化驱动西门子 TIA Portal**（SIMATIC STEP 7，面向 S7-1200/1500），基于 **TIA Portal Openness API**（`Siemens.Engineering.dll`）。

- **41 个 tool + 3 个 resource**：工程管理、程序块生成（SCL）、数据类型/变量表、全文搜索、编译、下载、库管理等
- **常驻 watcher 架构**：一个独立 PowerShell 进程通过 Openness 挂接/启动 TIA Portal，命令经文件 IPC 逐条下发
- **由汇川 InoProShop（CoDeSys）版改造而来**：保留了原项目的 MCP 工具契约与文件 IPC 协议，执行后端从 IronPython/ScriptEngine 整体切换为 PowerShell + Openness

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| **README.md**（本文） | 总览、快速上手、环境与配置 |
| [docs/TOOLS.md](docs/TOOLS.md) | **工具参考手册**：41 个 tool + 3 个 resource 的参数级说明 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **架构说明**：模块职责、IPC 协议、一条命令的完整旅程、设计决策 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | **故障排查手册**：按报错原文索引"原因 → 处理" |
| [SKILL.md](SKILL.md) | 实战踩坑沉淀（判据 + 可照抄的修法） |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录 |
| [SECURITY.md](SECURITY.md) | 安全策略 / 漏洞报告渠道 |

---

## ⚙️ 工作原理

```
MCP 客户端 ──stdio(JSON-RPC)── dist/bin.js（Server.ts，对应西门子 OB1 主入口）
                                 │  FB_ScriptManager：{PARAM} 插值 → 生成 .ps1 命令脚本
                                 ▼
                     文件 IPC（目录协议，与平台无关）
                     %TEMP%/tia-mcp-persistent/<session>/
                       commands/<id>.command.json + <id>.ps1
                       results/<id>.result.json
                       ready.signal / terminate.signal
                                 │
                                 ▼
                 watcher.ps1（独立 powershell.exe 常驻进程）
                 加载 Siemens.Engineering.dll（PublicAPI 自动检测）
                 逐条 dot-source 执行命令，共享 $Global:TiaPortal / $Global:TiaProject
                                 │
                                 ▼
                         TIA Portal（Openness 外部驱动）
```

两个关键特性：

1. **TIA Portal 永不被 watcher 杀掉** —— shutdown 只停 watcher 进程，TIA 本体和未保存的工程原样保留。
2. **惰性挂接** —— watcher 启动即写 ready.signal（MCP 握手立即完成），TIA Portal 挂接/冷启动延迟到第一条工程命令时才执行，避免初始化被防火墙确认框或分钟级冷启动卡住。

## 📁 工程结构（西门子模板风格）

代码按西门子模板的分层编号目录 + 功能块前缀命名组织（`FB_` 有状态块 / `FC_` 无状态函数 / `T_` 类型 / `G_` 全局常量）：

```
src/
  010_Core/            核心层：T_Types / FC_Logger / FC_PathUtils
  020_Config/          配置层：G_Config（超时、协议标记等集中参数表）
  030_Infrastructure/  基础设施层：FB_IpcClient / FB_TiaPortalLauncher / FB_HeadlessExecutor
  040_Services/        服务层：FB_ScriptManager / FB_ExecutorProxy / FC_ResultParser
  050_Server/          接口层：Server.ts（OB1 主入口）+ T_ToolContext
                       + FC_Register{Management,Project,Pou,Structure,Runtime,Library}Tools
                       + FC_RegisterResources + FC_ToolResponse
  bin.ts               CLI 入口（编译为 dist/bin.js）
  090_Scripts/         资源层：46 个 PowerShell 脚本
                       （watcher + headless 引导 + 5 个 helper + 39 个命令脚本，
                       构建时拷贝到 dist/090_Scripts）
```

---

## 🚀 快速上手

### 前置条件

| 项 | 要求 |
|---|---|
| 操作系统 | Windows（Openness 仅限 Windows） |
| TIA Portal | 建议 V16+，安装时勾选 **Openness 组件**（部分版本需授权） |
| Node.js | ≥ 18 |
| PowerShell | 5.1（Windows 自带即可） |

### 安装与自检

```cmd
npm install
npm run build
start-mcp.cmd --detect        &REM 扫描本机 TIA Portal 安装（无需 TIA 也能跑）
start-mcp.cmd --version       &REM 自检
```

### 接入 MCP 客户端

以 Claude Code 为例，在项目 `.mcp.json` 或全局配置中添加：

```json
{
  "mcpServers": {
    "tia-portal": {
      "command": "cmd",
      "args": [
        "/c",
        "C:/path/to/inoproshop-mcp/start-mcp.cmd"
      ]
    }
  }
}
```

> `start-mcp.cmd` 会自动探测 `C:\Program Files\Siemens\Automation\Portal V*` 下最新的安装；
> 需要指定版本时追加参数：`--tia-exe "<Siemens.Automation.Portal.exe 路径>" --tia-version "V17"`。

### 首次连接

TIA Portal 会弹出 **Openness 防火墙确认框**，勾选
*"Always allow connections from this application"* 一次即可，此后不再询问。

## 🔧 CLI 参数（bin.js）

| 参数 | 说明 | 默认 |
|---|---|---|
| `-p, --tia-exe <path>` | TIA Portal 可执行文件路径（可选：watcher 会挂接运行中的 TIA，或经 Openness 启动它） | 自动检测 |
| `-v, --tia-version <VXX>` | 版本提示，用于挑选 PublicAPI 的 `Siemens.Engineering.dll` | 自动取最新 |
| `-w, --workspace <dir>` | 相对工程路径的基准目录 | 当前目录 |
| `-m, --mode <mode>` | persistent（常驻 watcher）或 headless（每命令一个 powershell） | persistent |
| `--no-auto-launch` | 启动时不自动拉起 watcher | — |
| `--fallback-headless` | persistent 失败时回退 headless | 开 |
| `--keep-alive` | 服务端停止后保留 watcher 进程 | 关 |
| `--kill-existing-tia` | 启动前 taskkill TIA Portal（**开发用，会丢未保存工作**） | 关 |
| `--timeout <ms>` | 默认命令超时 | 60000 |
| `--allow-eval` | 注册 eval_powershell（任意 PowerShell 执行，**仅开发用**） | 关 |
| `--detect` | 扫描本机 TIA Portal 安装并退出 | — |
| `TIA_MCP_EXE` / `TIA_MCP_VERSION` | 环境变量形式的 exe 路径 / 版本提示 | — |
| `TIA_MCP_READY_TIMEOUT_MS` | watcher 就绪超时（环境变量） | 300000 |

## 🧰 工具能力矩阵（41 个 tool）

**完全支持**（Openness 原生能力）：

- **工程管理**（4）：create_project / open_project / save_project / list_project_templates
- **程序块**（6）：create_pou / set_pou_code / get_pou_code / get_all_pou_code / compile_project / get_compile_messages（经 SCL 外部源文件导入生成）
- **结构**（7）：create_folder / create_dut / create_gvl / delete_object / rename_object / search_code / rename_symbol
- **运行时**（9）：connect_to_device / disconnect_from_device / set_credentials / set_simulation_mode / download_to_device / read_variable / write_variable / monitor_variables / start_stop_application（部分受限，见下表）
- **库与设备**（11）：add_library / list_project_libraries / add_device / list_device_repository / inspect_device_node / set_device_parameter / map_io_channel / get_application_state / create_method / create_property / create_project_archive（部分受限，见下表）

**平台受限**（Openness 无对应 API，工具返回结构化诊断而不是静默失败）：

| 工具 | 原因 | 建议 |
|---|---|---|
| add_device / list_device_repository | Openness 无硬件目录 API | TIA UI 添加站点，或 AML/CAx 导入 |
| read_variable / write_variable / monitor_variables | 无在线过程值 API | OPC UA（CPU 内置）/ snap7 |
| get_application_state / start_stop_application | 无在线会话 API | TIA UI 在线诊断 / OPC UA |
| map_io_channel | 无 IO 绑定 API | TIA UI 设备视图 |
| create_method / create_property | SCL 无 CODESYS 式方法/属性 | 独立 FC 或直接暴露变量 |
| create_project_archive（部分版本） | Archive API 仅新版提供 | TIA UI 项目归档 |

## 📝 程序块生成说明（SCL）

TIA 无法逐行改写已编译块，本项目的标准流程是：

1. 生成 SCL 源文本（`FUNCTION_BLOCK "X"` / `FUNCTION` / `ORGANIZATION_BLOCK` / `TYPE…END_TYPE` / `VAR_GLOBAL…END_VAR`）
2. `ExternalSources.CreateFromFile(name, <temp>.scl)` 注册外部源（UTF-8 BOM，支持中文注释）
3. `GenerateBlocksFromSource()` 生成/覆盖同名块（反射兼容 V17/V21 两代方法名）
4. 保存工程

因此：create_pou 的 `language` 参数实际产出 **SCL** 块（LD/FBD 不支持文本生成）；
set_pou_code 会先导出既有块 XML 以保留接口，再整体重新生成。

## 🧪 验证

```cmd
npm test      &REM 39 个用例：IPC 往返 / 脚本插值 / 启动器 / e2e 模板管线 / .ps1 语法与编码校验
node dist/bin.js --version
node dist/bin.js --detect
```

Openness 相关的端到端行为（挂接 TIA、生成块、编译、下载）需要在装有 TIA Portal 的机器上验证；
本仓库 CI 无法覆盖（无 TIA 环境）。

## 📄 License

MIT（改造自 [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP)）
