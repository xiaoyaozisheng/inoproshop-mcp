# 变更记录

本包是 [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP) 的 **InoProShop 改造版**。

> ⚠️ **本包已与上游分叉。** 不要用上游的 README、示例或 profile 版本号覆盖本地文件。

## 0.7.2

### ✅ 恢复：`src/` 与 `tests/`（此前丢失，包不可重建）

- 此前包里只剩编译产物 `dist/`，`src/` 整个缺失 —— `npm run build` 直接失败，
  watcher.py 补丁等源码级改动无法维护。dist 的 sourcemap 里没有嵌入 sourcesContent，
  本地无法还原。
- 从上游克隆 `src/`（10 个 TS + 45 个 py）与 `tests/`（3 个单测文件 + 1 个集成 +
  `vitest.config.ts`），回填三个打补丁的 py（`watcher.py` / `compile_project.py` /
  `get_compile_messages.py`，直接取自 dist/scripts 的补丁版），并把两个 TS 补丁
  （`bin.ts` 的 `assertProfileExists`、`server.ts` 的 `decodeUriPath`）按编译产物
  逐行移植回源码。
- **验证**：重建后 `dist/` 与旧产物对比，8/10 个 js **逐字节一致**，仅有的两处差异
  就是本次新增的 `--allow-eval` 门控；`npm test` **39/39 通过**。

### 🔐 安全：`eval_python` 默认禁用，加 `--allow-eval` 才开放

- `eval_python` 可执行任意 IronPython，此前任何客户端接上就能拿到 IDE 的完整执行权。
- 现在：默认调用返回明确报错（不注册移除，工具仍可见以便提示）；`bin.ts` 新增
  `--allow-eval` 选项；`ServerConfig` 新增 `allowEval` 字段；启动日志会打印
  `eval_python: enabled/disabled`。

### 🚀 启动器：`start-mcp.cmd` 自动探测 profile + 新增 exe 存在性检查

- profile 名因机器而异（本包历史上实测过 `V1.9.0.1` 和 `V1.10.0.3` 两种），
  启动器现在**列 Profiles 目录自动选**（优先 `InoProShop*.profile`，否则第一个
  `*.profile`），不再写死；`--codesys-profile` 仍可覆盖。
- 新增第四道快速失败：`InoProShop.exe` 不存在时直接报错 `exit 2`。
- `--version` / `--help` / `--detect` 自检跳过 exe/profile 检查，**没装 IDE 的机器上也能跑**
  （真机验证：假 Profiles 目录下自动选中 `InoProShop(V1.9.0.1)`；自检路径 exit 0）。

### 📝 文档/配置一致性

- **修掉 README 自相矛盾**：顶部更正块说本机 profile 是 `V1.9.0.1`，但第三节、
  第四节、第七节仍写 `V1.10.0.3`。现在第三节/第七节统一为"两个实测值 + 以 Profiles
  目录为准"的表述，不再出现单机断言。
- `.mcp.json` 改为经 `cmd /c start-mcp.cmd` 启动（原先写死
  `Administrator` 的绝对路径 + 直接 `node dist/bin.js`），拷机只改一处路径。
- `examples/*.mjs`：4 个历史示例（`test-luke` / `write-cylinder` / `write-cylinder-fb` /
  `write-vacuum`）的写死工程路径、写死 cwd、写死 profile 全部改为
  `INOPROSHOP_PROJECT` 环境变量 + 包目录自解析 + `lib-profile.mjs` 自动探测；
  `verify-*` 两个自检脚本的 profile 回退值也改为自动探测。7 个脚本 `node --check` 全过。
- `package.json` 版本号 0.7.1 → 0.7.2。
- 新增 `docs/` 说明书三份：`TOOLS.md`（41 工具 + 3 资源 + CLI 参数 + 环境变量的参数级手册，
  参数全部从 `src/server.ts` 提取核对）、`TROUBLESHOOTING.md`（按报错原文索引的排查手册）、
  `ARCHITECTURE.md`（模块职责、IPC 数据流、设计决策）。
- **开源配套**：新增 `SECURITY.md`（漏洞报告渠道 + 本项目风险面说明）、GitHub Actions CI
  （`ci.yml`：ubuntu/windows × node 18/20 矩阵，`npm ci` + build + 39 用例，README 挂徽章）、
  英文版 `README.en.md`（与中文 README 同构，其余文档保持中文）。

## 0.7.1

### 🔴 修复：编译检查**瞒报** —— 有 288 条错误却报 `Message Count: 0`（严重）

- **现象**：`compile_project` 返回 `Compilation initiated ...` / `Message Count: 0`，
  `get_compile_messages` 答 `No compile messages found. The message API may not be available…`，
  **而 IDE 里当时有 288 条 Error**（`/* */` 注释被当代码那次）。
  两个工具**同时**指向"编译没问题"，极具误导性。
- **根因**（两条，各自独立）：
  1. `compile_project.py` 里 `COMPILE_CATEGORY_GUIDS`（含 Build）**只当"枚举失败时的兜底"**用。
     本机 `system.get_message_categories()` 在首次构建前只返回
     `['脚本消息', '预编译']` —— **非空**，于是兜底永远不触发，
     **真正装错误的 Build 类别（`97F48D64-A2A3-4856-B640-75C046E37EA9`）从未被扫描**。
  2. `get_compile_messages.py` 调 `system.get_message_objects()` **不传类别** → 恒返回 0 条。
     （另外 `App` 是 `ScriptObject`，**没有** `get_message_objects` 方法，Pattern 1 也是死路。）
- **修复**：
  - `compile_project.py`：把硬编码的编译类别**无条件并入**扫描列表（按规范化 GUID 去重）；
    新增 `BUILD RESULT: N error(s), M warning(s)` 与 `BUILD SUMMARY: …` 两行 ——
    因为 `KEEP_SEVS` 只保留 `fatal/error/warning`，干净构建时**所有消息都被过滤掉**，
    只剩 `Message Count: 0` 时无法区分"干净"与"没扫到"。补丁保持**纯 ASCII 源码**
    （IronPython 2.7 要求），中文关键字用 `u'\u6784\u5efa\u5b8c\u6210'` 转义匹配。
  - `get_compile_messages.py`：新增 **Pattern 0（主通道）** —— 枚举类别并合并硬编码编译 GUID，
    逐个 `script_engine.system.get_message_objects(guid)` 取消息；原有三种猜测降级为后备。
- **验证**（真机、同工程、同一次会话语境）：
  | 场景 | 修复前 | 修复后 |
  |---|---|---|
  | 干净工程 | `Message Count: 0` / `No compile messages found.` | `BUILD RESULT: 0 error(s), 0 warning(s)` + `BUILD SUMMARY: 构建完成--0错误,0警告：准备下载!`；`get_compile_messages` 列出 13 条 |
  | 故意注入未定义变量 | **`Message Count: 0`（瞒报）** | `BUILD RESULT: 2 error(s), 2 warning(s)` + `BUILD SUMMARY: 构建完成--2错误,2警告：不能下载！`；`get_compile_messages` 报 3 error(s) 并逐条列出 |

### ➕ 新增：`SKILL.md` —— 实战踩坑沉淀

- 汇总本机实测的四类坑：编译消息漏扫、`/* */` 注释不被 SP11 支持、
  ACT 无工具（底层 `create_action` 可用）、Method 声明必须带 `METHOD` 头。
  每条含**判据 + 可照抄的代码 + 通过判据原文**。`README.md` 已加入口指针。

## 0.7.0

### 🔴 修复：POU 里有中文时，读回工具永久卡死（严重）

- **现象**：`get_pou_code` / `get_all_pou_code` 永不返回；命令文件不被清理，
  watcher 每秒重试同一条命令，持续占满 IDE 的 CPU。IDE 本身仍能正常响应其他命令，
  所以看起来"只是慢"，极易误判。
- **根因**：`watcher.py` 写结果时用了 `json.dumps(...)` 的默认 `ensure_ascii=True`。
  IronPython 2.7 的 `py_encode_basestring_ascii` 会对**已经是 unicode** 的字符串
  再调一次 `s.decode('utf-8')`，只要 output 里有非 ASCII 字符就抛：

  ```
  UnicodeEncodeError: ('ascii', u'\u9879', 102, 103, "...")
  ```

  更糟的是 watcher 的 `except` 分支里 `"%s" % err` **自己会再抛一次同样的编码错误**，
  于是真实原因被彻底吞掉，结果文件永远写不出来。
- **触发条件**：POU 的声明或实现里出现任何非 ASCII 字符（中文注释、中文变量名、中文工程路径
  被打印出来）即可触发。**纯 ASCII 工程完全看不出问题** —— 这正是它长期潜伏的原因。
- **修复**（均在 `src/scripts/watcher.py`）：
  1. 结果序列化改用 `ensure_ascii=False`（`_text_utils.py` 的 `emit_result()` 早就这么做了，
     只有 watcher 自己的结果封装漏掉）；
  2. `OutputCapture` 缓冲统一成真 unicode。⚠️ IronPython 里 `isinstance(x, unicode)` 对
     **所有**字符串都返回 `True`，类型分派完全不可用，只能**按内容判据**区分：
     含字符 >255 的是真 unicode（需 `encode('utf-8')`），全部 <256 的是 UTF-8 字节的
     latin-1 视图（需 `decode('utf-8')`）；
  3. 单条命令处理崩溃时写回失败结果并**删除命令文件**，杜绝无限重试；
  4. 新增 `_safe_err()`，保证异常格式化本身不会再抛编码错误。

### 🟠 修复：profile 版本号（"版本号问题"）

- 早期文档写的 `InoProShop(V1.9.0.1)` 在目标机器上**根本不存在**，实际值是
  **`InoProShop(V1.10.0.3)`**（同目录下还有 `CODESYS V3.5 SP11 Patch 1.profile`）。
- README、`.mcp.json`、`examples/*.mjs` 中的版本号全部更正为**实测值**。
- `src/bin.ts` 新增启动前校验 `assertProfileExists()`：profile 不存在时**列出实际可用值并
  `exit(2)`**，而不是让 MCP 卡在等 `ready.signal` 上表现为"莫名挂起"。
- **版本号在不同机器 / 不同 IDE 版本上是不一样的，永远以目录实测为准：**

  ```powershell
  Get-ChildItem 'C:\Inovance Control\InoProShop\CODESYS\Profiles' -Filter *.profile |
      Select-Object -ExpandProperty Name
  ```

### 🟠 修复：resource URI 里的路径没有解码

- **现象**：`resources/read` 读 `codesys://project/{path}/structure` 或
  `.../pou/{pou_path}/code` 时失败，报
  `Requested project 'C:\...\%E9%A1%B9%E7%9B%AE\...' is not the currently-open one`。
- **根因**：客户端对 URI 里的路径做了百分号编码（`项目` → `%E9%A1%B9%E7%9B%AE`），
  而 MCP SDK 不会自动解码，编码后的字符串被当作真实路径传给 `require_project_open`，
  自然和已打开的工程对不上（该函数会**正确地**拒绝隐式切换工程）。
- **修复**：`src/server.ts` 新增 `decodeUriPath()`，在两个资源处理器里解码。
  仅在值**确实像**百分号编码时才解码，解码失败则回退原值，因此含字面 `%` 的路径不受影响。
  修复后「原样路径」和「百分号编码路径」两种写法都能正常读取。

### ➕ 新增：启动器 `start-mcp.cmd`

- 之前**包根目录没有任何启动服务端的东西**：服务端（`dist/server.js` + `dist/bin.js`）
  埋在 `dist/` 里，容易被误认为"这个包里没有 MCP 服务端"。
- 新增根目录启动器 `start-mcp.cmd`，自动带上 exe / profile / `--mode persistent`，
  并内置三道快速失败：
  - 找不到 `node` → 提示装 Node ≥ 18，`exit 2`；
  - `dist/bin.js` 不存在 → 提示先 `npm run build`，`exit 3`；
  - profile 不存在 → 列出实际可用值，`exit 2`（由 `assertProfileExists` 提供）。
- README 新增「服务端在哪、怎么起」一节，说明它是 **stdio 型服务端、不是常驻服务**：
  没有端口没有 URL，由客户端 spawn；双击会"看起来卡住"是在等客户端发消息；
  手工喂消息时 stdin 必须能结束，否则它会一直等。

### 🟡 修复：示例脚本

- `examples/*.mjs`（4 个）：
  - `PROFILE`：`InoProShop(V1.9.0.1)` → `InoProShop(V1.10.0.3)`；
  - `cwd`：从**并不存在的** `C:/Users/Administrator/codesys-mcp-luke` 改为本包目录。
- 仍有待使用者自行处理：示例里的 `PROJECT` 工程路径是**占位符**，运行前必须改成真实工程。

### ➕ 新增：自检脚本 `examples/verify-*.mjs`

- **`verify-tools.mjs`** —— 工具链端到端验证（`get_codesys_status` → `open_project` →
  `create_pou` → `set_pou_code`（**含中文注释**）→ `compile_project` → `get_all_pou_code` →
  `delete_object`），并断言中文完好、无乱码。会向工程写入再删除一个测试 POU（默认 `MCPTest`）。
- **`verify-resources.mjs`** —— 资源路径验证（`status` / `structure` / `pou code`），
  同时覆盖「原样路径」和「百分号编码路径」两种 URI 写法，并检查实例接管。只读。
- 两者都从环境变量 `INOPROSHOP_PROJECT` 读工程路径（**不再写死占位符**），
  支持 `INOPROSHOP_PROFILE` / `INOPROSHOP_EXE` / `INOPROSHOP_POU` / `INOPROSHOP_TESTPOU` 覆盖，
  包目录由脚本自身位置推导，可整包搬走。
- 本机实测：`verify-tools.mjs` **11/11**、`verify-resources.mjs` **13/13** 通过。

### 记录：中文补丁（第 1~3 项为上游既有，此处仅归档）

1. 读命令脚本用 UTF-8：`open(path, "rb").read().decode('utf-8')`；
2. 换行归一化 CRLF → LF；
3. `watcher.py` 自身保持纯 ASCII（IronPython 2.7 无编码声明时拒绝非 ASCII 源码）。

### 已知限制 / 交接注意事项

- **仓库内 `dist/` 只有 `dist/scripts/*.py`，没有任何编译产物**，且接手时机器上
  **未安装 Node.js**。必须先装 Node ≥ 18，再 `npm install && npm run build`，
  否则 `node dist/bin.js` 直接报找不到文件。
- **原先的 `dist/scripts/` 还是残缺的**：只有 30 个 py，而 `src/scripts/` 有 45 个 ——
  `compile_project.py`、`create_pou.py`、`create_project.py`、`search_code.py` 等
  核心脚本**原本都不在 dist 里**。跑一次 `npm run build` 即可补齐到 45 个。
- **`get_project_structure` / `get_pou_code` 是 resource 不是 tool**，必须用
  `resources/read`，用 `tools/call` 会报 `Tool ... not found`。
- **`watcher.py` 改完必须重启 InoProShop 才生效**（`--runscript` 仅在启动时载入）。
- `compile_project` 返回的编译消息只覆盖"脚本消息"这一个消息类别，
  **0 条消息 ≠ 全量编译通过**，最终请以 IDE 编译信息窗口为准。
- `set_device_parameter` 为实验性功能，很多总线参数是 GUI 专属、会报错。
- **不要使用 `--kill-existing-codesys`**，它会强杀正在运行的 InoProShop 并丢失未保存工作。

## 验证记录（0.7.0）

以下均在真机 + 真实 InoProShop(V1.10.0.3) 上实测通过：

- `npm install && npm run build` → `dist/bin.js` 存在，10 个 js + 45 个 py。
- 用错误 profile 启动 → `exit 2` 并列出实际可用 profile（不再表现为挂起）。
- MCP 端到端（`tools/call`）：`get_codesys_status` → `open_project` → `create_pou` →
  `set_pou_code`（**含中文注释**）→ `compile_project` → `get_all_pou_code` →
  `delete_object`，全部成功；`get_all_pou_code` **1.7s 返回、中文完好无乱码**
  （修复前此步 100% 永久卡死）。
- MCP 资源（`resources/read`）：`status` / `structure` / `pou code` 三种资源，
  「原样路径」与「百分号编码路径」两种写法共 15/15 断言通过。
- 实例接管：MCP 重启后 `Adopting existing session: PID ...`，**没有重复拉起** InoProShop。
