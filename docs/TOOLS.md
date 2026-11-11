# 工具参考手册（TOOLS.md）

> 适用版本：**0.7.2**。41 个 tool + 3 个 resource + CLI 参数 + 环境变量的参数级参考。
> 踩坑经验见 [`SKILL.md`](../SKILL.md)，出错先查 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)。

---

## 通用规则（先读这五条）

1. **路径一律用完整绝对路径**，正斜杠 `/` 或反斜杠 `\` 都可以；中文路径支持。
2. **`pouPath` / `objectPath` 格式**：相对工程根的路径，如 `Application/MyPOU`、
   `Application/FB_气缸/ACT_01_初始化`、`Application/FB_气缸/M_测试`（ACT/Method/Property
   走同一套路径解析）。
3. **前置条件**：带 `projectFilePath` 的工具会先确保该工程已打开（`ensure_project_open`）；
   但**拒绝隐式切换工程** —— 当前打开的不是这个文件时直接报错，先 `open_project` 再换。
   在线类工具（读/写变量、下载、启停）还需先 `connect_to_device`。
4. **成功判据**：工具返回 `SCRIPT_SUCCESS` 才算成功；`isError: true` 时看返回文本里的
   Python 报错。
5. **`eval_powershell` 默认禁用**（0.7.2 起）：调用返回明确报错，启动命令加 `--allow-eval` 才开放。

---

## 一、连接与状态

### get_tia_status
当前 TIA Portal 实例状态（state / PID / mode / ipcDir）。无参数。
未启动且未设 `--no-auto-launch` 时会**自动拉起 IDE**；已有活实例则**接管**（stderr 打印 `Adopting existing session`）。

### launch_tia
手动拉起 IDE（`--no-auto-launch` 模式下用）。无参数。

### shutdown_tia
关闭持久化的 IDE 实例。无参数。

### eval_powershell ⚠️ 默认禁用
| 参数 | 类型 | 说明 |
|---|---|---|
| `code` | string | PowerShell 2.7 源码。可用模块 `scriptengine`。**必须先 `print('SCRIPT_SUCCESS')` 再退出**，工具才报成功 |
| `timeoutMs` | int? | 超时（默认 30000） |

DEV 用：ScriptEngine API 审计、读 XML 等。勿调 IDE 的 Login（会卡主线程）。
开启方式见 §通用规则第 5 条；实战范例见 SKILL.md §1/§3。

---

## 二、工程与代码

### open_project
| 参数 | 说明 |
|---|---|
| `filePath` | 工程文件路径，如 `C:/Projects/MyPLC.project` |

打开后才能做其他工程操作；换工程也要显式走这一步。

### create_project
| 参数 | 说明 |
|---|---|
| `filePath` | 新工程要创建到的路径 |
| `templatePath` | 可选。用磁盘上一个 `.project` 作为模板复制 |
| `templateName` | 可选。用 TIA Portal 模板管理器里注册的模板名（先用 `list_project_templates` 查） |

默认复制内置 Standard.project。

### list_project_templates
列出本机 TIA Portal 可用的工程模板。可选参数：`extraTemplateDir`（额外扫描目录）。

### save_project
| 参数 | 说明 |
|---|---|
| `projectFilePath` | 要保存的工程（须为当前打开的） |

### create_pou
| 参数 | 说明 |
|---|---|
| `projectFilePath` | 工程路径 |
| `name` | POU 名（合法 IEC 标识符） |
| `type` | `Program` / `FunctionBlock` / `Function` |
| `language` | `ST` / `LD` / `FBD` / `SFC` / `IL` / `CFC` |
| `parentPath` | 父容器路径，通常 `Application` |

### set_pou_code
| 参数 | 说明 |
|---|---|
| `projectFilePath` | 工程路径 |
| `pouPath` | 目标对象完整路径（POU/Method/Property/ACT 通用） |
| `declarationCode` | 可选。声明区代码；省略或空串 = 不改动 |
| `implementationCode` | 可选。实现区代码；省略或空串 = 不改动 |

★ Method 的 `declarationCode` **必须带 `METHOD 名字 : 返回类型` 头**（见 SKILL.md §5）。
★ 代码里**不要用 `/* */` 注释**，用 `(* *)` 或 `//`（见 SKILL.md §2）。

### create_property
| 参数 | 说明 |
|---|---|
| `parentPouPath` | 父 FB 路径，如 `Application/MyFB` |
| `propertyName` | 属性名 |
| `propertyType` | 数据类型（`BOOL`/`INT`/自定义 DUT 名） |

### create_method
| 参数 | 说明 |
|---|---|
| `parentPouPath` | 父 FB 路径 |
| `methodName` | 方法名 |
| `returnType` | 可选。省略 = 无返回值 |

### create_dut
| 参数 | 说明 |
|---|---|
| `name` | DUT 名 |
| `dutType` | `Structure` / `Enumeration` / `Union` / `Alias` |
| `parentPath` | 通常 `Application` |

### create_gvl
| 参数 | 说明 |
|---|---|
| `name` | GVL 名 |
| `parentPath` | 通常 `Application` |
| `declarationCode` | 可选。初始 `VAR_GLOBAL…END_VAR` |

### create_folder
| 参数 | 说明 |
|---|---|
| `folderName` / `parentPath` | 文件夹名、父路径 |

### delete_object ⚠️ 破坏性
| 参数 | 说明 |
|---|---|
| `objectPath` | 要删除的对象路径 |

不可撤销；系统节点（Application、Device、Library Manager 等）会被拒绝。

### rename_object
| 参数 | 说明 |
|---|---|
| `objectPath` / `newName` | 对象路径、新名字 |

只改工程树节点名，**不改代码里的引用**（改引用用 `rename_symbol`）。

### get_all_pou_code
读回工程里**全部** POU/DUT/GVL 的声明+实现，一次返回。参数：`projectFilePath`。
写完代码后的标准校验手段。

### search_code
| 参数 | 说明 |
|---|---|
| `pattern` | 正则（默认）或字面子串 |
| `regex` | 可选，默认 true |
| `caseSensitive` | 可选，默认 true |
| `includeDeclaration` / `includeImplementation` | 可选，默认均 true |
| `maxHits` | 可选，默认 1000 |

返回 `file:line:col` 级命中；图形语言（LD/FBD）正文跳过。

### find_references
按词边界（`\bsymbol\b`）找符号全部引用。参数：`symbol`、`caseSensitive?`、`maxHits?`。
注释和字符串字面量**不排除**。

### rename_symbol ⚠️ 尽力而为
| 参数 | 说明 |
|---|---|
| `oldName` / `newName` | 旧/新符号名 |
| `dryRun` | 可选，**默认 true**（只报告不动手）；置 false 才真正改写 |
| `includeDeclaration` / `includeImplementation` | 可选，默认均 true |

只改文本正文；不改编译后的图形正文，不改工程树节点（那是 `rename_object`）。

### compile_project
编译主应用程序并返回结构化结论。参数：`projectFilePath`。
0.7.1 起返回 `BUILD RESULT: N error(s), M warning(s)` 和 `BUILD SUMMARY: 构建完成--…` 两行，
**干净与瞒报一眼可分**；认 `BUILD SUMMARY` 那句中文判据（见 SKILL.md §1）。

### get_compile_messages
取上次编译的消息缓存（不重新编译）。改了代码后先 `compile_project` 刷新再调。

### add_library
| 参数 | 说明 |
|---|---|
| `libraryName` | 库名（`Standard`、`Util`、`CAA Memory`…），须已装在库仓库里 |

### list_project_libraries
列出工程当前引用的全部库。参数：`projectFilePath`。

### create_project_archive
| 参数 | 说明 |
|---|---|
| `outputPath` | 输出 `.projectarchive` 路径（绝对或相对 workspace） |
| `comment` | 可选，写进归档元数据 |
| `includeLibraries` | 可选，默认 true |
| `includeCompiledLibraries` | 可选，默认 true；纯文本版本管理可置 false 减小体积 |

只读操作：不切换工程，要求工程已打开。

---

## 三、设备与配置

### list_device_repository
枚举本机设备仓库描述符，返回 name/vendor/device_type/device_id/version/…。
可选过滤：`vendor`、`nameContains`、`maxResults`（默认 500）。
**先查这里拿规范 id，再 `add_device`** —— 编错 id 会得到"语法合法但编译不过"的节点。

### add_device
| 参数 | 说明 |
|---|---|
| `parentDevicePath` | 父设备路径，如 `Device`、`Device/Ethernet` |
| `deviceName` | 新节点名 |
| `deviceType` | 设备类型 id（数字，来自设备仓库） |
| `deviceId` | 可选，设备 id（数字） |
| `version` | 可选，如 `3.5.16.0` |

### inspect_device_node
只读检查设备节点：描述符元数据、参数表及当前值、子设备。
参数：`projectFilePath`、`devicePath`（如 `Device`、`Device/Ethernet/EIP_Adapter`）。
配 `set_device_parameter` 前先用它找可写参数 id。

### set_device_parameter ⚠️ 实验性
| 参数 | 说明 |
|---|---|
| `devicePath` | 设备路径 |
| `parameterId` | 参数 id（数字；字符串兜底） |
| `value` | 按类型的文本形式（IP 用 `192.168.1.10`、BOOL 用 `TRUE`） |

很多总线参数是 GUI 专属，会返回明确报错；完整建 ECAT 轴建议 IDE 手动。

### map_io_channel
| 参数 | 说明 |
|---|---|
| `devicePath` | 设备节点路径 |
| `channelPath` | 通道相对地址：名字路径（`Inputs/Byte 0/Bit 3`）或数字索引（`0/3`） |
| `variableName` | 绑定的全局变量（如 `GVL.bSensor`） |
| `clearBinding` | 置 true 时清除绑定，`variableName` 被忽略 |

先用 `inspect_device_node` 摸清通道布局。

---

## 四、在线与运行时

> 本组工具除 `set_credentials` / `set_simulation_mode` / `list_device_repository` 外，
> 都要求已 `connect_to_device`。

### set_credentials
| 参数 | 说明 |
|---|---|
| `username` / `password` | 登录凭据（**用户名不能为空串**） |

每次会话在 `connect_to_device` 前设一次即可；运行时无认证就不要调。

### set_simulation_mode
| 参数 | 说明 |
|---|---|
| `enable` | 开/关仿真模式 |
| `verbose` | 可选，true 返回完整脚本输出 |

没有实机时先开仿真再 `connect_to_device`。

### connect_to_device
| 参数 | 说明 |
|---|---|
| `ipAddress` | 可选。登录前先设置网关/地址；不填则用设备已配置的网关或仿真模式 |
| `gatewayName` | 可选，默认 `Gateway-1`（仅在填了 ipAddress 时生效） |

登录（Login）到 PLC 运行时。

### disconnect_from_device
登出。未连接时按成功返回。参数：`projectFilePath`。

### get_application_state
报告运行状态（run / stop / exception）与登录状态。需已连接。

### read_variable
| 参数 | 说明 |
|---|---|
| `variablePath` | 变量路径，**不带 `Application.` 前缀**。例：`GVL_TestControl.iScenario`、`GVL_Cameras.stCam.aRoi[3].iValueMm` |

### write_variable ⚠️ 是"强制"不是写
| 参数 | 说明 |
|---|---|
| `variablePath` | 同 read_variable |
| `value` | IEC 字面量：`TRUE`、`42`、`INT#-3`、`3.14` |

走 set_prepared_value + force_prepared_values —— **变量会被强制保持**，直到解除强制或运行时重启。
适合控制标志、测试注入，不适合当程序输出。

### download_to_device
| 参数 | 说明 |
|---|---|
| `mode` | `auto`（默认：先试在线更改，失败退全量下载）/ `online_change`（失败即报）/ `full` |

下载编译好的应用到 PLC。先 `compile_project` 再下载。

### start_stop_application
| 参数 | 说明 |
|---|---|
| `action` | `start` / `stop` |

启停已连接设备上的应用。

### monitor_variables
| 参数 | 说明 |
|---|---|
| `variablePaths` | 变量路径数组 |
| `durationMs` | 采样总时长，**上限 60000** |
| `intervalMs` | 采样间隔，下限 10ms |

返回时间序列。**会阻塞 IDE 主线程**（有 60s 上限），采样的同时别在 IDE 里操作。

---

## 五、资源（resources / 只读）

> 它们**不是 tool**，用 `tools/call` 会报 `MCP error -32602: Tool ... not found`，
> 必须走 `resources/read`。资源走 `require_project_open`，拒绝隐式切换工程。

| URI | 说明 |
|---|---|
| `tia://project/status` | 脚本引擎/工程状态（静态，不需要路径） |
| `tia://project/{project_path}/structure` | 工程对象树 |
| `tia://project/{project_path}/pou/{pou_path}/code` | 单个 POU 的声明+实现 |

`{project_path}` 传原样路径或百分号编码路径都行（0.7.0 起两种都支持）。

---

## 六、CLI 参数（`node dist/bin.js` / `start-mcp.cmd`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `-p, --tia-exe <path>` | 标准 TIA Portal 安装路径 | IDE 可执行文件 |
| `-f, --tia-version <profile>` | 见下 | profile 名；**传错会列出实际可用值并 exit 2** |
| `-w, --workspace <dir>` | 当前目录 | 相对工程路径的基准目录 |
| `-m, --mode <mode>` | `persistent` | `persistent`（带 UI）或 `headless`（`--noUI`，回退用） |
| `--no-auto-launch` | 关 | 启动时不自动拉 IDE（需手动开或调 `launch_tia`） |
| `--fallback-headless` | 开 | persistent 失败时回退 headless |
| `--keep-alive` | 关 | 服务端停止后保留 IDE 进程 |
| `--kill-existing-tia` | **关，勿开** | 启动前强杀正在运行的 IDE（丢未保存工作） |
| `--timeout <ms>` | 60000 | 单条命令默认超时 |
| `--verbose` / `--debug` | 关 | 日志级别 |
| `--allow-eval` | **关** | 注册并开放 `eval_powershell`（0.7.2 起） |
| `--detect` | - | 扫描本机 TIA Portal 安装后退出 |
| `--version` / `--help` | - | 自检（无 IDE 的机器上也能跑） |

`start-mcp.cmd` 内置以上默认值并**自动探测 profile**，另加四道快速失败
（node / dist / exe / profile），详见 [README](../README.md)。

## 七、环境变量（examples 脚本用）

| 变量 | 必填 | 说明 |
|---|---|---|
| `INOPROSHOP_PROJECT` | verify-* 必填 | 工程文件路径 |
| `INOPROSHOP_EXE` | 可选 | 覆盖 IDE 路径 |
| `INOPROSHOP_PROFILE` | 可选 | 覆盖 profile（默认自动探测，见 `examples/lib-profile.mjs`） |
| `INOPROSHOP_POU` | 可选 | verify-resources 用的 POU 路径（默认 `Application/PLC_PRG`） |
| `INOPROSHOP_TESTPOU` | 可选 | verify-tools 的临时测试 POU 名（默认 `MCPTest`） |
