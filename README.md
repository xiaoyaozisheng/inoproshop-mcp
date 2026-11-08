# InoProShop MCP —— 汇川 AM/中型 PLC 程序化编程接口

这是一个打包好的 MCP（Model Context Protocol）服务器，用来**程序化读写 InoProShop**（汇川 AM/中型 PLC，CoDeSys SP11 内核）的代码。

> 📌 **另有 [`SKILL.md`](SKILL.md)：实战踩坑沉淀**（编译消息漏扫 Build 类别 / `/* */` 注释不支持 /
> ACT 与 Method 的建法与差异 / `eval_python` 默认禁用）—— **动手前建议与本文一并读**，那几个坑都会让你误判"一切正常"。

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| **README.md**（本文） | 总览、快速上手、环境与配置 |
| [docs/TOOLS.md](docs/TOOLS.md) | **工具参考手册**：41 个 tool + 3 个 resource 的参数级说明、CLI 参数、环境变量 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | **故障排查手册**：按报错原文索引"原因 → 处理" |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **架构说明**：模块职责、一条命令的完整旅程、设计决策 |
| [SKILL.md](SKILL.md) | 实战踩坑沉淀（判据 + 可照抄的修法） |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录（含验证证据） |

---

## ⚠️ 给下一个 AI：开工前必读（四个会让你白干一小时的坑）

**1. Profile 的版本号，绝对不要照抄本文档。**

不同机器 / 不同 IDE 版本上这个值**不一样**，写错会导致 `--profile` 不匹配、IDE 起不来或实例接管失败。**每次都先列目录取实际值**：

```powershell
Get-ChildItem 'C:\Inovance Control\InoProShop\CODESYS\Profiles' -Filter *.profile |
    Select-Object -ExpandProperty Name
```

> 本文档早期版本写的是 `InoProShop(V1.9.0.1)` —— 在本文档所对应的这台机器上**实测是错的**，
> 正确值是 **`InoProShop(V1.10.0.3)`**（该目录下还有 `CODESYS V3.5 SP11 Patch 1.profile`）。
> **凡是本文档里出现版本号的地方，一律以目录实测为准，不要复制粘贴。**

> ### ★★ 本机更正（2026-09-21 实测，与上面那段**相反**）
>
> 在这台机器上，列目录的结果**只有** `InoProShop(V1.9.0.1).profile` 和
> `CODESYS V3.5 SP11 Patch 1.profile`，**根本没有 V1.10.0.3**。
> 而且用 `InoProShop(V1.9.0.1)` 跑通了完整闭环（拉起 IDE → 开工程 → 建 GVL →
> 改 POU → 保存 → 关机）。
> ⇒ **本机正确值 = `InoProShop(V1.9.0.1)`**。0.7.2 起 `start-mcp.cmd` 会**自动探测** profile，
> `.mcp.json` 已改为调用 `start-mcp.cmd`（配置里不再写版本号）。
>
> ⚠️ 若之后装了 V1.10.0.3 那个完整包，profile 名会变 —— **再列一次目录**即可。
> 判据永远是 `Profiles` 目录，不是任何文档。

**2. Node.js ≥ 18 是前置条件 —— 先 `node -v` 确认。**

很多机器上压根没装 Node（本包初次接手的那台机器就没有）。**分发包**自带完整
`src/`、`tests/` 和已构建好的 `dist/`，开箱即可 `node dist/bin.js`（或走 `start-mcp.cmd`），
**不需要先构建**；但 `dist/` 不入 git（构建产物），**从 git 克隆的必须先跑一次
`npm run build`**；之后只有改了 `src/` 源码才需要重新构建：

```bash
cd <本包目录>
npm install
npm run build        # tsc 编译 + 拷贝 src/scripts -> dist/scripts
npm test             # 39 个用例（单元 + 脚本模板集成），改完源码建议跑一遍
```

**3. 改了 `src/scripts/watcher.py`，必须重启 InoProShop 才生效。**

watcher.py 是 IDE 启动时通过 `--runscript` 载入的，运行期间替换文件不会重新加载。

**4. `get_project_structure` 和 `get_pou_code` 不是 tool，是 resource。**

用 `tools/call` 调它们会直接报 `MCP error -32602: Tool ... not found`。必须走 `resources/read`：

| 资源 URI | 说明 |
|---|---|
| `codesys://project/status` | 脚本引擎/工程状态（静态，不需要路径） |
| `codesys://project/{project_path}/structure` | 工程对象树 |
| `codesys://project/{project_path}/pou/{pou_path}/code` | 单个 POU 的声明+实现 |

`{project_path}` 传**原样路径**或**百分号编码路径**都行（0.7.0 起两种都支持）。
注意这两个资源走的是 `require_project_open`，**拒绝隐式切换工程** —— 如果工程还没打开，
先显式 `open_project`。

**另外**：`examples/` 里有两类脚本，别搞混。

- **`verify-tools.mjs` / `verify-resources.mjs`（0.7.0 新增，推荐先跑）** —— 自检脚本，
  自带断言、路径可移植，工程路径从环境变量读、不写死：

  ```bash
  set INOPROSHOP_PROJECT=C:\path\to\your.project
  node examples/verify-tools.mjs       # 工具链端到端 + 中文回归断言（会读也会写）
  node examples/verify-resources.mjs   # 资源路径 + 实例接管（只读）
  ```

  可选环境变量：`INOPROSHOP_PROFILE` / `INOPROSHOP_EXE` / `INOPROSHOP_POU` / `INOPROSHOP_TESTPOU`。
  注意 `verify-tools.mjs` 会向工程里**写入再删除**一个测试 POU（默认 `MCPTest`）。
  这两个脚本在本机实测分别是 **11/11** 和 **13/13** 通过。

- **`test-luke.mjs` / `write-cylinder.mjs` / `write-cylinder-fb.mjs` / `write-vacuum.mjs`**
  是历史示例（0.7.2 起同样从环境变量读工程路径、自动探测 profile、按脚本位置定位包目录），
  不设 `INOPROSHOP_PROJECT` 会直接报错退出，不会误写别的工程。

---

## 服务端在哪、怎么起

**入口在 `dist/` 里，不在包根目录** —— 这是最容易让人以为"这包里没有服务端"的地方：

| 文件 | 作用 |
|---|---|
| `dist/server.js` | 服务端实现（`package.json` 的 `main`，约 85 KB） |
| `dist/bin.js` | CLI 入口（`package.json` 的 `bin`）—— **客户端实际 spawn 的就是它** |
| `start-mcp.cmd` | 根目录启动器：自动探测 profile、带上 exe / `--mode persistent`，先过 node / `dist/` / exe / profile 四道检查 |

自检（都是亚秒级）：

```bat
start-mcp.cmd --version     :: 0.7.2
start-mcp.cmd --help
```

**它是 stdio 型服务端，不是常驻服务。** 没有端口、没有 URL，由 MCP 客户端按需
spawn 一个子进程、用 stdin/stdout 说 JSON-RPC。所以：

- 桌面上**看不到**"正在运行的 MCP 服务端"，这是正常的；
- 直接双击 `start-mcp.cmd` 会看起来"卡住" —— 那是在等客户端发消息，不是死机；
- 想手工喂一条消息，**输入必须能结束**，否则它会一直等下去：

  ```bat
  echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}} > req.jsonl
  start-mcp.cmd --no-auto-launch < req.jsonl
  ```

不加 `--no-auto-launch` 时，服务端启动后会**自动拉起 InoProShop**；如果已经有活着的
实例，它会**接管**（stderr 出现 `Adopting existing session`），不会重复拉起。

启动器内置四道快速失败，避免"莫名挂起"：

| 情况 | 行为 |
|---|---|
| 找不到 `node` | 提示装 Node ≥ 18，`exit 2` |
| `dist/bin.js` 不存在 | 提示先 `npm run build`，`exit 3` |
| `InoProShop.exe` 不存在 | 提示用 `--codesys-path` 指实际位置，`exit 2` |
| Profiles 目录里没有 `*.profile` | 提示安装或显式传 `--codesys-profile`，`exit 2` |

> 另有一道兜底：即使绕过启动器直接 `node dist/bin.js` 传错 profile，
> `bin.js` 启动时的 `assertProfileExists` 也会列出实际可用值并 `exit 2`。

> **DSH 桌面端本身不带 MCP 客户端能力**（base bundle 的依赖里没有任何 MCP 插件），
> 它不读 `.mcp.json`。`.mcp.json` 是给 Claude Code / Cursor / Windsurf 这类客户端用的，
> 注册方式见第四节。

---

任何支持 MCP 的 AI（Claude Code、Cursor、Windsurf 等）读完本文件即可接入。
但请先按上面第 1、2 条核对环境，再动手做别的。

---

## 一、这是什么

- 基于 [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP) 改造，持久化模式。
- 通过 InoProShop 的 ScriptEngine（IronPython 2.7）读写工程。
- **UI 保持可交互**：后台线程轮询命令，主线程执行，脚本返回后 IDE 不会卡死。
- **自动接管**：MCP 服务器重启后会自动接管已运行的 InoProShop 实例，不用重启 IDE。
- **已打中文补丁**：中文路径、中文注释、中文变量名全部支持（见第五节）。
- **源码与测试入包**（0.7.2）：`src/` + `tests/` 齐全，`npm test` 39 个用例；
  `eval_python` 默认禁用（加 `--allow-eval` 开启）。

## 二、环境要求

- Windows 10/11
- Node.js >= 18
- 已安装 InoProShop（默认路径见下方）

## 三、直接启动

```bash
node dist/bin.js \
  --codesys-path "C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe" \
  --codesys-profile "InoProShop(V1.9.0.1)" \
  --mode persistent \
  --no-auto-launch
```

> `--codesys-profile` 的值**因机器而异**（本包历史上在两台机器上分别实测为
> `V1.9.0.1` 和 `V1.10.0.3`），一律以 Profiles 目录为准（见第七节）。
> 更省事的办法是用根目录的 `start-mcp.cmd` —— 0.7.2 起它会**自动探测** profile。

## 四、接入 MCP 客户端（Claude Code 等）

在项目根目录放一个 `.mcp.json`，让它调用 `start-mcp.cmd`（profile 自动探测、
exe / dist / node / profile 四道快速失败都内置在启动器里，拷到别的机器**只需改这一个路径**）：

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "cmd",
      "args": [
        "/c", "C:\\Users\\iouli\\Desktop\\plc\\inoproshop-mcp\\start-mcp.cmd",
        "--no-auto-launch"
      ]
    }
  }
}
```

（本文件夹里已附了这份 `.mcp.json`，直接拷走即可。注意：`--no-auto-launch` 表示不会在启动时自动打开 InoProShop，需要写代码前**先手动打开 InoProShop**（或调 `launch_codesys` 工具）；若拷到别的机器/目录，把上面那一个 `start-mcp.cmd` 路径改成实际存放位置。要开放 `eval_python` 再追加 `"--allow-eval"`。）

## 五、写代码核心流程

按顺序调用这几个工具即可完成「打开工程 → 建 POU → 写代码 → 编译」：

| 步骤 | 工具 | 关键参数 |
|---|---|---|
| 1. 查状态 | `get_codesys_status` | 无（自动启动/接管 InoProShop） |
| 2. 打开工程 | `open_project` | `filePath`：工程文件路径，如 `C:/xxx/xxx.project` |
| 3. 建 POU | `create_pou` | `projectFilePath`、`name`、`type`（`Program`/`FunctionBlock`/`Function`）、`language`（`ST` 等）、`parentPath`（通常 `Application`） |
| 4. 写代码 | `set_pou_code` | `projectFilePath`、`pouPath`（如 `Application/MyPOU`）、`declarationCode`、`implementationCode` |
| 5. 编译 | `compile_project` | `projectFilePath` |
| 6. 读回校验 | `get_all_pou_code` | `projectFilePath` |

### 示例：写一个气缸程序 Program

`create_pou`：
```json
{ "projectFilePath": "C:/PLC/test.project", "name": "CylinderCtrl",
  "type": "Program", "language": "ST", "parentPath": "Application" }
```

`set_pou_code`：
```json
{
  "projectFilePath": "C:/PLC/test.project",
  "pouPath": "Application/CylinderCtrl",
  "declarationCode": "PROGRAM CylinderCtrl\nVAR\n    xStart : BOOL; // 伸出命令\nEND_VAR",
  "implementationCode": "IF xStart THEN\n    xDone := TRUE;\nEND_IF"
}
```

`compile_project`：
```json
{ "projectFilePath": "C:/PLC/test.project" }
```

> 更多完整示例见 `examples/` 目录下的 `.mjs` 脚本（`write-vacuum.mjs` 等，含中文注释的真空吸、气缸 FB 封装）。

## 六、中文支持（已打补丁）

原始项目在 IronPython 2.7 下遇到中文会崩（`UnicodeDecodeError`），本包已修复。补丁都在 `src/scripts/watcher.py`：

1. 读命令脚本用 UTF-8：`open(path, "rb").read().decode('utf-8')`（原来默认 ASCII）。
2. 换行符归一化：CRLF → LF（二进制读会跳过 Python 2 的通用换行转换）。
3. watcher.py 自身保持纯 ASCII（IronPython 2.7 无编码声明时拒绝非 ASCII 源码）。
4. **结果回传不用 `json.dumps()` 的默认 `ensure_ascii=True`。** IronPython 2.7 的
   `py_encode_basestring_ascii` 会对**已经是 unicode** 的字符串再调一次
   `s.decode('utf-8')`，只要输出里有中文就抛 `UnicodeEncodeError`
   （`'ascii' codec can't decode byte ... in position N`）。后果很隐蔽：结果文件永远
   写不出来 → 命令文件不被清理 → watcher 每秒重试同一条命令、烧 IDE 的 CPU。
   现改为 `ensure_ascii=False`，并把 `OutputCapture` 的缓冲统一成真 unicode。
   注意 IronPython 里 `isinstance(x, unicode)` 对**所有**字符串都返回 `True`
   （字节风味串也是），所以只能**按内容判据**区分：字符 > 255 的是真 unicode，
   需要 `encode('utf-8')`；全是字符 < 256 的是 UTF-8 字节的 latin-1 视图，需要
   `decode('utf-8')`。`_text_utils.py` 的 `emit_result()` 早就用了
   `ensure_ascii=False`，只有 watcher 自己的结果封装漏了。
5. watcher 处理单条命令崩溃时，会写回一条失败结果并**删除命令文件**，不再无限重试。

**结论：工程路径、注释、变量名、字符串字面量都可以用中文。**

> 注意：watcher.py 是 IDE 启动时通过 `--runscript` 载入的，**改了它必须重启 InoProShop 才生效**。

## 七、关键配置值（务必用对）

- 可执行文件：`C:/Inovance Control/InoProShop/CODESYS/Common/InoProShop.exe`
  （自定义安装位置时用 `--codesys-path` 覆盖；`start-mcp.cmd` 在 exe 不存在时会直接报错退出。）
- Profile：**不同机器 / 不同 IDE 版本上不一样，本包历史上实测过两个值** ——
  一台机器上只有 `InoProShop(V1.9.0.1)`，另一台上只有 `InoProShop(V1.10.0.3)`。
  **判据永远是 Profiles 目录，不是任何文档：**

  ```powershell
  Get-ChildItem 'C:\Inovance Control\InoProShop\CODESYS\Profiles' -Filter *.profile |
      Select-Object -ExpandProperty Name
  ```

  - `start-mcp.cmd`（0.7.2 起）**自动探测**：优先选 `InoProShop*.profile`，否则取第一个
    `*.profile`；要固定指定就追加 `--codesys-profile "<名字>"`。
  - 即使直接传错 profile 也不会"莫名挂起"——`dist/bin.js` 启动时会校验
    （`assertProfileExists`），不存在就列出实际可用值并 `exit 2`。

  写错 profile 的后果是 IDE 起不来或接管失败，所以宁可多列一次目录，**不要照抄任何文档里的版本号**。

## 八、工具总览（41 个）

**代码类**：`open_project` `create_project` `save_project` `create_pou` `set_pou_code` `create_property` `create_method` `create_dut` `create_gvl` `create_folder` `delete_object` `rename_object` `get_all_pou_code` `search_code` `find_references` `rename_symbol` `compile_project` `get_compile_messages`

**设备/配置类**：`add_device` `list_device_repository` `inspect_device_node` `set_device_parameter` `map_io_channel` `list_project_libraries` `add_library` `list_project_templates` `create_project_archive`

**在线/运行时**：`connect_to_device` `disconnect_from_device` `download_to_device` `set_credentials` `set_simulation_mode` `get_application_state` `read_variable` `write_variable` `start_stop_application` `monitor_variables`

**其他**：`get_codesys_status` `launch_codesys` `shutdown_codesys` `eval_python`

> `eval_python` 可执行任意 IronPython 代码（ScriptEngine API 审计/读 XML 等），DEV 用，勿调 IDE 的 Login（会卡主线程）。
> **0.7.2 起默认禁用**（任意代码执行面太大）：调用会返回明确报错，需要时给启动命令加 `--allow-eval`。

## 九、注意事项

1. **不要用 `--kill-existing-codesys`**（会强杀正在运行的 InoProShop，丢未保存工作）。默认关闭。
2. MCP 重启会自动接管活着的实例；若要加载新补丁，需先手动关闭 InoProShop。
3. `set_device_parameter` 是实验性的，很多总线参数是 GUI 专属会报错；完整建 ECAT 轴建议 IDE 手动。
4. 写代码后记得 `compile_project`；编译结果可在 IDE 的编译信息窗口看。

---

## 重新构建（改了源码才需要）

```bash
npm install
npm run build   # tsc 编译 + 拷贝 src/scripts -> dist/scripts
npm test        # 39 个用例（vitest）：3 个单元测试文件 + 1 个脚本模板集成
```
