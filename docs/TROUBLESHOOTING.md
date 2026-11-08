# 故障排查手册（TROUBLESHOOTING.md）

> 按症状索引：**先对报错原文，再看"原因 → 处理"**。
> 深度根因分析见 [`SKILL.md`](../SKILL.md) 与 [`CHANGELOG.md`](../CHANGELOG.md)。

---

## 1. 启动/服务端层面

### `start-mcp.cmd` 直接退出，打印 `[ERROR] ...`
| 报错 | 原因 | 处理 |
|---|---|---|
| `node not found on PATH`（exit 2） | 没装 Node 或不在 PATH | 装 Node.js ≥ 18，`node -v` 验证 |
| `dist\bin.js not found`（exit 3） | 包没构建 | `npm install && npm run build`（0.7.2 起包内自带 dist，一般不会遇到） |
| `InoProShop.exe not found at ...`（exit 2） | IDE 不在默认路径 | `start-mcp.cmd --codesys-path "C:/你的路径/InoProShop.exe"` |
| `No *.profile found in ...`（exit 2） | 没装 IDE 或安装位置不同 | 装 IDE，或同时传 `--codesys-path` + `--codesys-profile` |

### `[FATAL] CODESYS profile 'X' does not exist on this machine.`（exit 2）
profile 名**因机器而异**（本包历史上实测过 `V1.9.0.1` 和 `V1.10.0.3` 两种）。
处理：按报错里列出的 Available 值选一个，或 `start-mcp.cmd`（自动探测）。**永远不要抄文档里的版本号**。

### 双击 `start-mcp.cmd` "卡住"
不是死机 —— 它是 stdio 型服务端，在等客户端发 JSON-RPC。正常。
手工喂消息时输入必须能结束（`echo ... | start-mcp.cmd` 或重定向文件）。

### 服务端挂起不动、一直等 `ready.signal`
- 最常见原因：profile 不对，IDE 起不来 → 0.7.2 起已有多道快速失败，先看有没有 `[FATAL]`/`[ERROR]` 输出；
- IDE 已在运行但实例接管失败：看 stderr 有无 `Adopting existing session: PID ...`；
  没有且也不新开窗口 → 手动关掉 IDE 再起；
- 加 `--debug` 重启看详细日志。

### `Adopting existing session: PID ...`
**不是报错**。MCP 重启后自动接管了还活着的 IDE + watcher，无需重启 IDE。
注意：接管的是**旧 watcher**——改过 `src/scripts/watcher.py` 后必须**手动关 IDE 再重开**才能生效。

---

## 2. 工具调用层面

### `MCP error -32602: Tool ... not found`（调 `get_project_structure` / `get_pou_code` 时）
这俩是 **resource 不是 tool**，必须走 `resources/read`：
`codesys://project/status`、`codesys://project/{project_path}/structure`、
`codesys://project/{project_path}/pou/{pou_path}/code`。详见 [TOOLS.md](TOOLS.md) 第五节。

### `eval_python is disabled by default ...`
0.7.2 起的门控，不是坏了。启动命令加 `--allow-eval`；不开就换替代方案
（编译取证 → `get_compile_messages`；建 ACT → IDE 手动），见 SKILL.md §0。

### `Requested project 'X' is not the currently-open one`
- **工程没开或开错了**：先显式 `open_project`（工具拒绝隐式切换工程，这是保护行为）；
- URI 里路径被百分号编码导致对不上：0.7.0 起服务端会自动解码，若仍复现，
  改传原样路径。

### `POU声明不完整，没有名称`（写 Method 时）
`declarationCode` **没带 `METHOD 名字 : 返回类型` 头**。后面跟着的一串
"没有定义标识符" 全是连带伤，别去查变量名。正确写法见 SKILL.md §5.2。

### 一写 banner 注释就炸几十条错（`符号'/' 不能识别`、`应该用';' 替换'**'`）
CODESYS SP11 **不支持 `/* */` 块注释**（IEC 61131-3 第三版才有）。换成 `(* … *)` 或 `//`。
批量转换脚本见 SKILL.md §2。

### 编译结果看不懂 / 不敢信
认 `BUILD SUMMARY:` 那行中文判据：
- `构建完成--0错误,0警告：准备下载!` → 真通过；
- `构建完成--N错误,M警告：不能下载！` → 有错，逐条列在消息里。
0.7.1 已修复"漏扫 Build 类别导致 `Message Count: 0` 瞒报"的问题；
若 `get_compile_messages` 返回 0 条且无 `BUILD RESULT` 行，先 `compile_project` 一次再取。

### 中文变乱码 / `UnicodeEncodeError: 'ascii' codec ...`
0.7.0 已修复（watcher.py 结果序列化）。若复现：说明 IDE 里跑的还是**旧 watcher**，
关掉 IDE 重开（`--runscript` 只在启动时载入）。

---

## 3. 在线/运行时层面

### `connect_to_device` 失败
- 实机：确认网关和 IP。不确定就传 `ipAddress`（会自动先设网关/地址）；
- 没有实机：先 `set_simulation_mode {enable: true}` 再连；
- 运行时需要认证：先 `set_credentials`（用户名不能为空串），再连；
- 连接前确认已 `compile_project` 且工程是当前打开的那个。

### `write_variable` 写了但程序逻辑"不改"
它是**强制（force）**不是赋值 —— 变量会一直保持写入值，直到解除强制/运行时重启。
这是设计行为，用于控制标志和测试注入，别拿来当程序输出通道。

### `monitor_variables` 期间 IDE 卡住
该工具**阻塞 IDE 主线程**（上限 60s）。采样期间别在 IDE 里操作，等待返回即可。

### `download_to_device` 在线更改被拒
`mode` 默认 `auto` 会自动退回全量下载；指定了 `online_change` 被拒属正常
（在线更改有严格前提），改用 `full`。

### `set_device_parameter` 报"GUI-only"
该工具是实验性的，很多总线参数没有脚本接口。用 `inspect_device_node` 先确认参数
是否可写；完整配置（如建 ECAT 轴）建议 IDE 手动。

### `add_device` 建出的设备编译不过
deviceId/deviceType 编错了会生成"语法合法但设备不匹配"的节点。
用 `list_device_repository` 拿规范 id 再建，删掉错的用 `delete_object`。

---

## 4. 示例脚本层面（examples/*.mjs）

| 报错 | 处理 |
|---|---|
| `缺少 INOPROSHOP_PROJECT` | 设环境变量再跑：`set INOPROSHOP_PROJECT=C:\path\to\my.project` |
| `无法确定 profile` | IDE 装在非默认位置时设 `INOPROSHOP_EXE`，或显式设 `INOPROSHOP_PROFILE` |
| 脚本 TIMEOUT | 服务端 stderr 尾部会打出来，按本文第 1 节排查 |

`verify-tools.mjs` 会向工程**写入再删除**一个测试 POU（默认名 `MCPTest`）——
确认工程已保存、可接受临时对象再跑。

---

## 5. 还是不行？

按顺序收集这些信息再求助：
1. `start-mcp.cmd --version`（确认包健康）；
2. `--debug` 模式的服务端 stderr；
3. IDE 里的消息窗口（编译类问题以 IDE 为准）；
4. `%TEMP%\codesys-mcp-persistent\` 下对应会话目录的 `watcher.log` / `watcher_error.txt`；
5. `%TEMP%\codesys-mcp-compile-debug.txt`（编译消息扫描的调试落盘）。
