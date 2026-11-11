# TIA Portal MCP — Programmatic Programming Interface for Inovance AM / Mid-Range PLCs

[![CI](https://github.com/xiaoyaozisheng/inoproshop-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaoyaozisheng/inoproshop-mcp/actions/workflows/ci.yml)

[简体中文](README.md) | **English**

A packaged MCP (Model Context Protocol) server for **programmatically reading and writing TIA Portal** (Inovance AM / mid-range PLC, CoDeSys SP11 kernel) code.

> 📌 Also read [`SKILL.md`](SKILL.md): hard-won field notes (compile-message scanning misses the Build category / `/* */` comments are unsupported / how ACT and Method differ / `eval_powershell` disabled by default) — **read it together with this file before you start**; every one of those pitfalls will fool you into thinking "everything is fine".
>
> 🌐 **Note on languages**: only this README is bilingual. [`SKILL.md`](SKILL.md), [docs/TOOLS.md](docs/TOOLS.md), [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [CHANGELOG.md](CHANGELOG.md) are currently Chinese-only.

## 📚 Documentation Map

| Document | Contents |
|---|---|
| **README.en.md** (this file) | Overview, quick start, environment & configuration |
| [README.md](README.md) | Chinese original |
| [docs/TOOLS.md](docs/TOOLS.md) | **Tool reference** (Chinese): parameter-level docs for 41 tools + 3 resources, CLI args, env vars |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | **Troubleshooting guide** (Chinese): indexed by exact error message → cause → fix |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **Architecture** (Chinese): module responsibilities, life of one command, design decisions |
| [SKILL.md](SKILL.md) | Field notes from real runs (checks + copy-paste fixes, Chinese) |
| [CHANGELOG.md](CHANGELOG.md) | Change log with verification evidence (Chinese) |
| [SECURITY.md](SECURITY.md) | Security policy / vulnerability reporting |

---

## ⚠️ Before You Start — Four Pitfalls That Will Cost You an Hour Each

**1. Never copy the profile version number from any documentation — including this one.**

The value **differs per machine / per IDE version**. A wrong value means `--profile` doesn't match, the IDE won't start, or instance adoption fails. **Always list the directory and take the actual value**:

```powershell
Get-ChildItem 'C:\Inovance Control\TIA Portal\TIA Portal\Profiles' -Filter *.profile |
    Select-Object -ExpandProperty Name
```

> Earlier versions of this doc said `TIA Portal(V1.9.0.1)` — on one machine that was **measured wrong**,
> the actual value there was **`TIA Portal(V1.10.0.3)`** (that directory also had `TIA Portal V3.5 SP11 Patch 1.profile`).
> On yet another machine the directory contained **only** `TIA Portal(V1.9.0.1).profile`, and a full
> closed loop was verified with it (launch IDE → open project → create GVL → edit POU → save → shutdown).
> **Wherever a version number appears in any doc, the Profiles directory wins. Never copy-paste.**
>
> Since 0.7.2 `start-mcp.cmd` **auto-detects** the profile, and `.mcp.json` calls `start-mcp.cmd`
> (no version pinned in the config). If you later install another IDE version, **list the directory again**.

**2. Node.js ≥ 18 is a prerequisite — run `node -v` first.**

Plenty of machines have no Node at all (the machine this package was first adopted on didn't). The **distribution package** ships complete `src/`, `tests/` and a **pre-built `dist/`** — it works out of the box with `node dist/bin.js` (or via `start-mcp.cmd`), **no build needed**. But `dist/` is not committed to git (build output), so **if you cloned from git you must run `npm run build` once first**; after that you only rebuild when `src/` changes:

```bash
cd <package directory>
npm install
npm run build        # tsc compile + copy src/090_Scripts -> dist/090_Scripts
npm test             # 39 cases (unit + script-template integration); run after touching src/
```

**3. If you change `src/090_Scripts/watcher.ps1`, you must restart TIA Portal for it to take effect.**

watcher.ps1 is loaded by the IDE at startup via `--runscript`; replacing the file while running does not reload it.

**4. `get_project_structure` and `get_pou_code` are resources, not tools.**

Calling them via `tools/call` fails outright with `MCP error -32602: Tool ... not found`. Use `resources/read`:

| Resource URI | Description |
|---|---|
| `tia://project/status` | Script engine / project status (static, no path needed) |
| `tia://project/{project_path}/structure` | Project object tree |
| `tia://project/{project_path}/pou/{pou_path}/code` | One POU's declaration + implementation |

`{project_path}` accepts a **raw path** or a **percent-encoded path** (both supported since 0.7.0).
Note both resources go through `require_project_open`, which **refuses to implicitly switch projects** —
if no project is open yet, call `open_project` explicitly first.

**Also**: `examples/` contains two kinds of scripts — don't mix them up.

- **`verify-tools.mjs` / `verify-resources.mjs` (new in 0.7.0, run these first)** — self-check scripts
  with built-in assertions and portable paths; the project path comes from an env var, never hard-coded:

  ```bash
  set INOPROSHOP_PROJECT=C:\path\to\your.project
  node examples/verify-tools.mjs       # toolchain end-to-end + regression assertions (reads and writes)
  node examples/verify-resources.mjs   # resource paths + instance adoption (read-only)
  ```

  Optional env vars: `INOPROSHOP_PROFILE` / `INOPROSHOP_EXE` / `INOPROSHOP_POU` / `INOPROSHOP_TESTPOU`.
  Note that `verify-tools.mjs` **writes then deletes** a test POU in the project (default `MCPTest`).
  On the reference machine these two scripts passed **11/11** and **13/13** respectively.

- **`test-luke.mjs` / `write-cylinder.mjs` / `write-cylinder-fb.mjs` / `write-vacuum.mjs`**
  are historical examples (since 0.7.2 they also read the project path from env vars, auto-detect the
  profile, and locate the package dir relative to the script). Without `INOPROSHOP_PROJECT` they exit
  with an error instead of writing to the wrong project.

---

## Where the Server Lives and How to Start It

**The entry point is inside `dist/`, not the package root** — the single easiest place to conclude "this package has no server in it":

| File | Role |
|---|---|
| `dist/server.js` | Server implementation (`package.json` `main`, ~85 KB) |
| `dist/bin.js` | CLI entry (`package.json` `bin`) — **this is what an MCP client actually spawns** |
| `start-mcp.cmd` | Root launcher: auto-detects the profile, adds exe / `--mode persistent`, runs four fast-fail checks (node / dist / exe / profile) |

Self-check (both sub-second):

```bat
start-mcp.cmd --version     :: 0.7.2
start-mcp.cmd --help
```

**It is a stdio server, not a resident service.** No port, no URL — the MCP client spawns a child
process on demand and speaks JSON-RPC over stdin/stdout. So:

- You will **not** see a "running MCP server" anywhere on the desktop — that is normal;
- Double-clicking `start-mcp.cmd` will look "stuck" — it's waiting for a client message, not frozen;
- To hand-feed one message, **the input must terminate**, otherwise it waits forever:

  ```bat
  echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}} > req.jsonl
  start-mcp.cmd --no-auto-launch < req.jsonl
  ```

Without `--no-auto-launch`, the server **auto-launches TIA Portal** on startup; if a live instance
already exists it **adopts** it (stderr shows `Adopting existing session`) instead of launching a second copy.

The launcher has four built-in fast-fails to avoid "mysteriously hanging":

| Condition | Behavior |
|---|---|
| `node` not found | Tells you to install Node ≥ 18, `exit 2` |
| `dist/bin.js` missing | Tells you to run `npm run build`, `exit 3` |
| `TIA Portal.exe` missing | Tells you to pass `--tia-exe` with the real location, `exit 2` |
| No `*.profile` in the Profiles directory | Tells you to install or pass `--tia-version` explicitly, `exit 2` |

> One more safety net: even bypassing the launcher and running `node dist/bin.js` directly with a wrong
> profile, `bin.js` validates at startup (`assertProfileExists`), lists the actually available values and `exit 2`.

> **The DSH desktop client itself has no MCP client capability** (no MCP plugin in the base bundle
> dependencies) and does not read `.mcp.json`. `.mcp.json` is for clients like Claude Code / Cursor /
> Windsurf; registration is covered in section IV.

---

Any MCP-capable AI (Claude Code, Cursor, Windsurf, …) can integrate after reading this file.
But first verify the environment per items 1 and 2 above before doing anything else.

---

## I. What This Is

- Adapted from [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP), persistent mode.
- Reads and writes projects through TIA Portal's ScriptEngine (PowerShell 2.7).
- **The UI stays interactive**: a background thread polls for commands, the main thread executes them;
  the IDE does not freeze while a script runs.
- **Automatic adoption**: after the MCP server restarts it adopts the running TIA Portal instance;
  no IDE restart needed.
- **Chinese-text patches applied**: Chinese paths, comments and variable names all work (see section VI).
- **Source and tests shipped** (0.7.2): complete `src/` + `tests/`, `npm test` runs 39 cases;
  `eval_powershell` is disabled by default (enable with `--allow-eval`).

## II. Requirements

- Windows 10/11
- Node.js >= 18
- TIA Portal installed (default path below)

## III. Direct Launch

```bash
node dist/bin.js \
  --tia-exe "C:/Inovance Control/TIA Portal/TIA Portal/Common/TIA Portal.exe" \
  --tia-version "TIA Portal(V1.9.0.1)" \
  --mode persistent \
  --no-auto-launch
```

> The `--tia-version` value **differs per machine** (measured on two machines in this package's
> history: `V1.9.0.1` on one, `V1.10.0.3` on the other) — always go by the Profiles directory (section VII).
> The easier route is the root `start-mcp.cmd` — since 0.7.2 it **auto-detects** the profile.

## IV. Wiring Up an MCP Client (Claude Code etc.)

Put a `.mcp.json` in your project root that calls `start-mcp.cmd` (profile auto-detected; the four
fast-fails are built into the launcher; when copying to another machine **only this one path changes**):

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "cmd",
      "args": [
        "/c", "C:\\path\\to\\inoproshop-mcp\\start-mcp.cmd",
        "--no-auto-launch"
      ]
    }
  }
}
```

(A ready-made `.mcp.json` ships in this folder — copy it and adjust the single `start-mcp.cmd` path.
Note: `--no-auto-launch` means TIA Portal is not opened automatically at server start — **open
TIA Portal manually before writing code** (or call the `launch_tia` tool). Append `"--allow-eval"`
to enable `eval_powershell`.)

## V. Core Workflow for Writing Code

Call these tools in order to complete "open project → create POU → write code → compile":

| Step | Tool | Key parameters |
|---|---|---|
| 1. Check status | `get_tia_status` | none (auto-launches / adopts TIA Portal) |
| 2. Open project | `open_project` | `filePath`: project file path, e.g. `C:/xxx/xxx.project` |
| 3. Create POU | `create_pou` | `projectFilePath`, `name`, `type` (`Program`/`FunctionBlock`/`Function`), `language` (`ST` etc.), `parentPath` (usually `Application`) |
| 4. Write code | `set_pou_code` | `projectFilePath`, `pouPath` (e.g. `Application/MyPOU`), `declarationCode`, `implementationCode` |
| 5. Compile | `compile_project` | `projectFilePath` |
| 6. Read back to verify | `get_all_pou_code` | `projectFilePath` |

### Example: a cylinder-control Program

`create_pou`:
```json
{ "projectFilePath": "C:/PLC/test.project", "name": "CylinderCtrl",
  "type": "Program", "language": "ST", "parentPath": "Application" }
```

`set_pou_code`:
```json
{
  "projectFilePath": "C:/PLC/test.project",
  "pouPath": "Application/CylinderCtrl",
  "declarationCode": "PROGRAM CylinderCtrl\nVAR\n    xStart : BOOL; // extend command\nEND_VAR",
  "implementationCode": "IF xStart THEN\n    xDone := TRUE;\nEND_IF"
}
```

`compile_project`:
```json
{ "projectFilePath": "C:/PLC/test.project" }
```

> More complete examples live in `examples/` (`write-vacuum.mjs` etc., including a vacuum gripper and
> a cylinder FB wrapper with Chinese comments).

## VI. CJK / Chinese Support (patched)

The original project crashes on Chinese text under PowerShell 2.7 (`UnicodeDecodeError`); this package
fixes it. The patches are all in `src/090_Scripts/watcher.ps1`:

1. Command scripts are read as UTF-8: `open(path, "rb").read().decode('utf-8')` (previously defaulted to ASCII).
2. Line endings normalized: CRLF → LF (binary reads skip Python 2's universal-newline translation).
3. watcher.ps1 itself stays pure ASCII (without an encoding declaration PowerShell 2.7 rejects non-ASCII source).
4. **Result reporting no longer uses `json.dumps()`'s default `ensure_ascii=True`.** PowerShell 2.7's
   `py_encode_basestring_ascii` calls `s.decode('utf-8')` **again on strings that are already unicode**;
   any Chinese in the output throws `UnicodeEncodeError`
   (`'ascii' codec can't decode byte ... in position N`). The failure is insidious: the result file is
   never written → the command file is never cleaned up → the watcher retries the same command every
   second, burning the IDE's CPU. Now fixed with `ensure_ascii=False`, and the `OutputCapture` buffer
   is unified to true unicode. Note that in PowerShell `isinstance(x, unicode)` returns `True` for
   **every** string (byte-flavored ones too), so they can only be told apart **by content**: strings
   containing chars > 255 are true unicode and need `encode('utf-8')`; strings that are all < 256 are
   a latin-1 view of UTF-8 bytes and need `decode('utf-8')`. `_text_utils.ps1`'s `emit_result()` already
   used `ensure_ascii=False`; only the watcher's own result envelope was missing it.
5. When the watcher crashes handling a single command it now writes back a failure result and
   **deletes the command file** instead of retrying forever.

**Bottom line: Chinese in project paths, comments, variable names and string literals all works.**

> Note: watcher.ps1 is loaded by the IDE at startup via `--runscript`; **changing it requires restarting
> TIA Portal to take effect**.

## VII. Critical Configuration Values (Get These Right)

- Executable: `C:/Inovance Control/TIA Portal/TIA Portal/Common/TIA Portal.exe`
  (override with `--tia-exe` for custom install locations; `start-mcp.cmd` exits with an error if the exe is absent.)
- Profile: **differs per machine / per IDE version — two values have been measured in this package's
  history**: one machine had only `TIA Portal(V1.9.0.1)`, the other only `TIA Portal(V1.10.0.3)`.
  **The Profiles directory is always the source of truth, not any doc:**

  ```powershell
  Get-ChildItem 'C:\Inovance Control\TIA Portal\TIA Portal\Profiles' -Filter *.profile |
      Select-Object -ExpandProperty Name
  ```

  - `start-mcp.cmd` (since 0.7.2) **auto-detects**: prefers `TIA Portal*.profile`, else the first
    `*.profile`; to pin one, append `--tia-version "<name>"`.
  - Even a directly-passed wrong profile cannot "mysteriously hang" — `dist/bin.js` validates at
    startup (`assertProfileExists`) and exits 2 listing the actually available values.

  A wrong profile means the IDE won't start or adoption fails, so list the directory one extra time
  rather than **copying any version number from any doc**.

## VIII. Tool Overview (41 tools)

**Code**: `open_project` `create_project` `save_project` `create_pou` `set_pou_code` `create_property` `create_method` `create_dut` `create_gvl` `create_folder` `delete_object` `rename_object` `get_all_pou_code` `search_code` `find_references` `rename_symbol` `compile_project` `get_compile_messages`

**Device / configuration**: `add_device` `list_device_repository` `inspect_device_node` `set_device_parameter` `map_io_channel` `list_project_libraries` `add_library` `list_project_templates` `create_project_archive`

**Online / runtime**: `connect_to_device` `disconnect_from_device` `download_to_device` `set_credentials` `set_simulation_mode` `get_application_state` `read_variable` `write_variable` `start_stop_application` `monitor_variables`

**Other**: `get_tia_status` `launch_tia` `shutdown_tia` `eval_powershell`

> `eval_powershell` can execute arbitrary PowerShell (ScriptEngine API audits / XML reading etc.), for DEV
> use; don't call the IDE's Login from it (blocks the main thread).
> **Disabled by default since 0.7.2** (arbitrary code execution is too large a surface): calls return an
> explicit error; add `--allow-eval` to the launch command if you need it.

## IX. Operational Notes

1. **Do not use `--kill-existing-tia`** (force-kills a running TIA Portal, losing unsaved work). Off by default.
2. An MCP restart automatically adopts the live instance; to load new patches, close TIA Portal manually first.
3. `set_device_parameter` is experimental; many bus parameters are GUI-only and error out. Building a
   complete ECAT axis is best done manually in the IDE.
4. After writing code remember to `compile_project`; results appear in the IDE's message view.

---

## Rebuilding (only needed if you changed the source)

```bash
npm install
npm run build   # tsc compile + copy src/090_Scripts -> dist/090_Scripts
npm test        # 39 cases (vitest): 3 unit test files + 1 script-template integration suite
```
