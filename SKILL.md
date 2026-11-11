# TIA Portal MCP —— 实战沉淀（SKILL）

> 这份是 **踩坑记录 + 判据 + 修法**，配合 `README.md`（开工前必读）与 `CHANGELOG.md` 使用。
> 全部内容都在真机上实测过：**TIA Portal V1.9.0.1（TIA Portal V3.5 SP11 内核）**，
> 工程 `C:\Users\Administrator\Desktop\测试\PLC程序\未命名4\未命名4.project`。
> 记录时间：2026-09-21。
>
> **0.7.2 更新（2026-11-08）**：① `eval_powershell` **默认禁用**（见 §0），本文两处靠它的流程
> 要加 `--allow-eval` 才能照抄；② profile 名**因机器而异**，`start-mcp.cmd` 已改为自动探测，
> 别抄任何文档里的版本号；③ `src/`、`tests/` 已恢复入包，改脚本请改 `src/090_Scripts/` 再构建。

---

## ⚠️ 结论先行：四个会让你误判的问题

| # | 问题 | 严重度 | 性质 |
|---|---|---|---|
| 1 | **`compile_project` 报的"0 条消息"是假的** —— 它漏扫了真正装错误的 **Build** 消息类别 | 🔴 会让人以为编译通过 | **本包缺陷 → 已修复（§1）** |
| 2 | **`/* */` 块注释这个 TIA Portal 不支持** —— 会被当代码解析，一条 banner 炸十几条错 | 🔴 直接编译失败 | TIA Portal SP11 语言限制 |
| 3 | **没有建 Action(ACT) 的工具** —— 41 个 tool 里只有 `create_method` | 🟡 功能缺口（底层 API 有） | 本包的缺口 |
| 4 | **写 Method 的声明时必须带 `METHOD 名字 : 返回类型` 头** —— 只送 `VAR…END_VAR` 会炸 15 条错 | 🟠 容易踩、报错很绕 | `set_pou_code` 的语义问题 |

---

## 0. 🟠 0.7.2 起 `eval_powershell` 默认禁用（本文两处流程受影响）

### 现象
```
eval_powershell → isError: "eval_powershell is disabled by default because it executes arbitrary
PowerShell inside the IDE. Restart the server with --allow-eval to enable it."
```
**这不是坏了，是新门控**（任意代码执行面太大，见 CHANGELOG 0.7.2）。启动日志里也会印一行
`eval_powershell: disabled (start with --allow-eval to enable)`。

### 受影响的照抄段落
| 位置 | 流程 | 不开门控的替代 |
|---|---|---|
| §1 | 编译消息取证（`se.system.get_message_objects(BUILD_GUID)`） | 直接用 `get_compile_messages` —— 0.7.1 已把同等逻辑内置为该工具的主通道 |
| §3 | `pou.create_action(name)` 建 ACT | IDE 里手动右键 New Action；建完正文仍可用 `set_pou_code` 写入 |

### ✅ 开法
启动命令追加 `--allow-eval`。`.mcp.json` 里写法：
```json
"args": [ "/c", "…\\start-mcp.cmd", "--no-auto-launch", "--allow-eval" ]
```
用 `start-mcp.cmd` 手跑就直接 `start-mcp.cmd --allow-eval`。

---

## 1. 🔴 `compile_project` 说"编译 0 条消息"≠ 编译通过

### 现象
```
compile_project      → "Compilation initiated ..." / Message Count: 0
get_compile_messages → "No compile messages found. The message API may not be available in this TIA Portal version."
```
**看起来一切正常，实际上当时工程里有 288 条 Error。**

### 根因
本机 `scriptengine.system.get_message_categories()` 返回 **3 个**类别，而 `compile_project.ps1`
只扫了枚举结果的前 2 个：

| guid | 类别 | 本包扫了吗 |
|---|---|---|
| `194b48a9-ab51-43ae-b9a9-51d3edaaddf3` | 脚本消息 | ✅ |
| `217bc73e-759b-4a3c-bfa1-991c938a6541` | 预编译 | ✅ |
| **`97f48d64-a2a3-4856-b640-75c046e37ea9`** | **Build（真正的编译错误全在这里）** | ❌ **漏了** |

`%TEMP%\tia-portal-mcp-compile-debug.txt`（每次覆盖的调试落盘）里能直接看到这个遗漏：
```
DEBUG: 2 message categories will be scanned (source: dynamic)
DEBUG:   [0] 脚本消息 ...
DEBUG:   [1] 预编译 ...
```

### ✅ 正确的取法（实测可用，照抄）
```python
import time
import scriptengine as se

BUILD_GUID = '97f48d64-a2a3-4856-b640-75c046e37ea9'

app = se.projects.primary.active_application
app.clean()            # 都实测不抛异常
app.build()
app.generate_code()
time.sleep(1.5)        # 等消息落定

for m in se.system.get_message_objects(BUILD_GUID):   # ★ 必须走 system，不是 app
    print(m.severity, m.text)
```
调用方式：`tools/call` → `eval_powershell`，把上面整段当 `code` 传进去
（**0.7.2 起需先加 `--allow-eval`**，见 §0；不开门控就直接用 `get_compile_messages`，
主通道就是这段逻辑的内置版）。

### 三个会白折腾的细节
1. **`app.get_message_objects(...)` 不存在** —— `App` 是 `ScriptObject`，没这个方法，
   报 `'ScriptObject' object has no attribute 'get_message_objects'`。
   ⇒ **必须用 `se.system.get_message_objects(guid)`**。
2. **返回值不支持切片** —— `got[:30]` 报 `expected int, got slice`；只能 `for m in got:` 迭代 + 自己计数。
3. **`get_message_categories()` 返回的是 `Guid` 对象**，`c.name` 不存在（`'Guid' object has no attribute 'name'`），
   要 `str(c)` 才拿到 guid 字符串。

### ✅ 通过判据（一句话，认这句）
```
构建完成--0错误,0警告：准备下载!
```
出现这句才是真通过。**只看条数、只看 `Message Count: 0`，会翻车。**

### 附带的 RETAIN 生效判据
编译通过时会看到：
```
内存区域1包含 保持数据：大小为4096字节，最高使用的地址为800，最大连续内存间距为3296字节(80%)
```
⇒ 保持区有占用，说明 `VAR_GLOBAL RETAIN` 的变量真的进了保持区。

### ✅ 已修复（2026-09-21，实机验证通过）

**改了两个脚本**：

**① `src/090_Scripts/compile_project.ps1`**（构建后同步到 `dist/090_Scripts/`）—— 把硬编码的编译类别**无条件并入**扫描列表（原来只当"枚举失败时的兜底"，
而枚举非空就永远轮不到它）；并新增两行**可判断的结论输出**：

```
DEBUG: merged 2 hardcoded compile category(ies) into the scan list
DEBUG: 4 message categories will be scanned
DEBUG:   [1] 编译   (guid=97f48d64-a2a3-4856-b640-75c046e37ea9)     ← 以前根本没有这一行
DEBUG: category '编译' (13 msgs total, 0 kept)
BUILD RESULT: 0 error(s), 0 warning(s)                              ← 新增
BUILD SUMMARY: 构建完成--0错误,0警告：准备下载!                        ← 新增
```
> `BUILD RESULT` / `BUILD SUMMARY` 是必要的：`KEEP_SEVS` 只保留 `fatal/error/warning`，
> 干净构建时消息全被过滤掉，**只剩 `Message Count: 0` 就分不清"干净"和"没扫到"** ——
> 这两行就是用来消歧的。
> ⚠️ 匹配"构建完成"用的是 `u'\u6784\u5efa\u5b8c\u6210'` 转义，
> 因为 **PowerShell 2.7 不接受无编码声明的非 ASCII 源码**，补丁必须保持纯 ASCII。

**② `src/090_Scripts/get_compile_messages.ps1`**（构建后同步到 `dist/090_Scripts/`）—— 新增 **Pattern 0（主通道，已验证）**：
枚举类别（并合并硬编码的三个编译 GUID）→ 逐个 `script_engine.system.get_message_objects(guid)`。
原来的三种猜测全部让位：`app.get_message_objects()` 方法不存在，
`system.get_message_objects()` **不传类别恒返回 0** —— 这就是它以前永远答
`No compile messages found.` 的原因。

**③ `package.json` 版本 → `0.7.1`**（见 `CHANGELOG.md`；当前版本已是 **0.7.2**）。

#### 验证证据（真机、同工程）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 干净工程 | `Message Count: 0` / `No compile messages found.` | `BUILD RESULT: 0 error(s), 0 warning(s)` + `BUILD SUMMARY: 构建完成--0错误,0警告：准备下载!`；`get_compile_messages` 列出 **13 条**消息 |
| **故意注入一个未定义变量** | `Message Count: 0` / `No compile messages found.`（**瞒报**） | `BUILD RESULT: 2 error(s), 2 warning(s)` + `BUILD SUMMARY: 构建完成--2错误,2警告：不能下载！`；`get_compile_messages` 报 **3 error(s)**，逐条列出 `没有定义标识符'...'` |

⇒ **"0 条消息"这个坑已经堵死**：现在干净就是干净、报错就是报错，两者一眼可分。

---

## 2. 🔴 `/* */` 块注释：这个 TIA Portal 不支持，会把注释当代码

### 现象
按常见的 banner 风格写注释：
```st
/******************01.上电一次：HMI <- 掉电保持（FOR）*******************/
```
编译直接炸 **288 条 Error**，典型消息：
```
符号'/' 不能识别
应该用';' 替换'**'            ← 90 条
符号'**' 不能识别             ← 90 条
符号'：' 不能识别             ← 13 条（banner 里的全角冒号）
应该用';' 替换'01.'  /  符号'03.' 不能识别
发现不正确的文件结束标记: 应该用'END_FOR'
```

### 根因
`/* … */` 是 **IEC 61131-3 第三版**才有的注释。**TIA Portal V3.5 SP11 没实现**，
所以 `/`、`*`、`**` 全被当成运算符 ⇒ 一条 banner 能炸出十几条错，
而且报错会**连累后面**（`END_FOR` 缺失之类的二次错误）。

### ✅ 修法
用**视觉完全一样**的 `(* … *)` 形式：
```st
(* ******************01.上电一次：HMI <- 掉电保持（FOR）******************* *)
```
- `(* … *)` 是 SP11 上**唯一可靠的块注释**；`//` 行注释也可用。
- 批量转换（**纯 ASCII 脚本，别在 .ps1 里写中文字面量**，否则按 ANSI 读会乱码）：
```powershell
$u8 = [System.Text.UTF8Encoding]::new($false)
foreach ($l in [System.IO.File]::ReadAllLines($path, $u8)) {
  $t = $l.Trim()
  if ($t.Length -gt 4 -and $t.StartsWith('/') -and $t.EndsWith('/') -and -not $t.StartsWith('//')) {
    $out.Add('(* ' + $t.Substring(1, $t.Length - 2) + ' *)')   # 去掉首尾 '/'，套上 (* *)
  } else { $out.Add($l) }
}
[System.IO.File]::WriteAllLines($path, $out.ToArray(), $u8)
```

---

## 3. 🟡 ACT（Action）：没有工具，但底层 API 能建

### 缺口
41 个 tool 里**没有**建 Action 的（只有 `create_method` 建"方法"）。
但 ScriptEngine 的 POU 对象**有 `create_action`**：
```python
pou = se.projects.primary.active_application.find('FB_气缸', True)[0]
print(hasattr(pou, 'create_action'))     # True
pou.create_action('ACT_01_初始化')       # 一行一个，1 个参数就够
proj.save()
```
**判据**：`pou.get_children(False)` 里能看到全部 ACT 名字（实测 13/13 成功）。

> ⚠️ `eval_powershell` 0.7.2 起默认禁用 —— 启动加 `--allow-eval` 再照抄这段（见 §0）；
> 不开门控就在 IDE 里手动建 ACT，建完正文仍走 `set_pou_code` 写入。

### 把正文写进 ACT —— 用现成的 `set_pou_code` 就行
`pouPath` 直接写路径，**不需要新工具**：
```
tools/call set_pou_code
  pouPath = "Application/FB_气缸/ACT_01_初始化"
  implementationCode = <正文>
```
实测 13 个 ACT 全部写入成功。ACT 与 POU 走同一套 `find_object_by_path` 解析。

### ⚠️ 这些 ScriptEngine 对象 `dir()` 返回**空**
`dir(pou)` 什么都看不到，但 `hasattr(pou, 'create_action')` 是 `True`。
⇒ **判能力只能用 `hasattr`，别用 `dir()`**（`dir()` 为空会让你误判"这对象什么都不会"）。

### ACT 的两个语法约束（设计时会撞上）
1. **ACT 不能自己声明变量** —— 所有内部变量必须写在 **POU 的声明区**。
   所以声明区要提前按"接口 / 引脚 / 内部变量"分段留好空间。
2. ACT 在 POU 正文里**用裸名字调用**：`ACT_01_初始化();`，不需要任何前缀/限定符。

---

## 4. 本次实测标尺（可当"这套路是通的"的参照）

工程 `未命名4.project`：**628,098 B → 657,873 B（+29,775）**，21 个对象一次建成：

```
PLC_PRG                       外围 5 段
ST_气缸Keep/ST_气缸Ctrl/ST_气缸HMI    3 个结构体
GVL_气缸常量(CONSTANT) / GVL_气缸Keep(RETAIN) / GVL_气缸
FB_气缸                       声明 3 段 + 正文只做 CASE 状态机
 └ ACT_01_初始化 … ACT_05_异常          (5 个状态)
 └ ACT_11_位置检测 … ACT_18_到达信号     (8 个功能)
```
编译结果：`构建完成--0错误,0警告：准备下载!`
`数据总大小 78,064 B ／ 代码 288,988 B ／ 保持区最高地址 800`

**全程只有 3 个非预期失败**，就是本文上面那三个。

### 被设计倒逼出来的几条做法（可复用）
1. **一个 GVL 不能既保持又不保持** ⇒ 拆成 常量 / RETAIN / 普通 三个 GVL。
2. **"初始化只跑一次"不需要标志位**：把状态变量放在**非保持**结构体里（上电必回初值），
   每个实例天然各跑一次初始化。
3. **急停这类最高优先级用"全局迁移"**：在 `CASE` **之前**判 `IF b急停 THEN 状态:=急停`，
   一行覆盖所有状态；其余迁移放各状态 ACT 末尾。
4. **到位后不断输出时，超时计时不能用"阀输出"** —— 到位后输出还在，计时器不复位 ⇒ 假超时。
   要用"动作中"标志，并写成 `IN := 动作中 AND NOT 到位`。
5. **"屏蔽"用软信号顶替硬件**（而不是"延时到位"）：
   `IF b屏蔽 THEN 实际:=软信号 ELSE 实际:=硬件 END_IF` ——
   FB 只认"信号"一个概念，且"屏蔽时要不要报超时"这个问题自然消失。
6. **单控阀的"原点"= 输出断开**（弹簧复位）⇒ 判断方向只能靠"命令/动作中"，不能靠阀输出。

---

## 5. 🟠 Method（METH）：能建能写，但**声明必须带 `METHOD` 头**

### 5.1 走的是**官方工具**（不像 ACT 得绕 `eval_powershell`）
```
tools/call create_method
  parentPouPath = "Application/FB_气缸"
  methodName    = "M_测试"
  returnType    = "BOOL"        ← 可省略；省略 = 无返回值
```
正文用 `set_pou_code`，`pouPath = "Application/FB_气缸/M_测试"`（路径写法和 ACT 完全一样）。
**建 → 写 → 编译 → `delete_object` 删除，全流程实测通过。**

### 5.2 ★★ 关键坑：Method 的 `declarationCode` 必须带上 `METHOD` 头

只送 `VAR…END_VAR`（像给结构体那样）**直接炸 15 条错**，而且报错非常绕：
```
POU声明不完整，没有名称            ← ★ 头一条就是真因
没有定义标识符'i测试计数'           ← 局部变量"看起来没定义"
'i测试计数'是无效的赋值目标
未知类型: 'i测试计数'
没有定义标识符't测试定时'
需要程序名、函数或功能块实例替代 't测试定时'
没有定义标识符'M_测试'             ← 连方法自己的名字都不认识
'M_测试'是无效的赋值目标
构建完成--15错误,2警告：不能下载！
```

**正确写法**（声明区要把 `METHOD` 头一起写）：
```st
METHOD M_测试 : BOOL
VAR
    i测试计数 : INT;
    t测试定时 : TON;
END_VAR
```
补上这一行 ⇒ `构建完成--0错误,0警告：准备下载!` ✓

> **判据**：看见 `POU声明不完整，没有名称` 就是这个原因，**别去查变量名**（那 14 条全是它的连带伤）。

### 5.3 ACT 与 Method 的选型差异（会决定你怎么切功能）

| | ACT（Action） | Method |
|---|---|---|
| 建法 | **没有工具** ⇒ `eval_powershell` 调 `pou.create_action(name)`（需 `--allow-eval`，见 §0） | **有工具** `create_method` |
| 声明区 | **无** —— 共享 POU 的声明区，自己不能声明变量 | **有自己的**（但必须带 `METHOD` 头） |
| 局部变量 | ❌ 只能全写到 POU 声明区 | ✅ 可以有 |
| 返回类型 | ❌ | ✅ |
| 正文写入 | `set_pou_code` 路径 `…/FB/ACT_xx` ✓ | `set_pou_code` 路径 `…/FB/M_xx` ✓ |
| 调用 | 裸名字：`ACT_01_初始化();` | 赋值式：`x := M_测试();` |

⇒ **要封装独立小功能、又不想污染 POU 声明区 ⇒ 用 Method**；
**要按执行顺序切段、共享同一批变量 ⇒ 用 ACT**。
本次气缸封装用的是 **ACT**（用户明确要求），Method 只做了能力验证后删除。
