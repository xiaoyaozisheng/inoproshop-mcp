# 安全策略 / Security Policy

## 支持的版本 / Supported Versions

| 版本 / Version | 支持情况 / Supported |
|---|---|
| 0.7.x | ✅ 接收安全修复 / receives security fixes |
| < 0.7.0 | ❌ 请升级 / please upgrade |

## 如何报告漏洞 / How to Report a Vulnerability

**首选 / Preferred: GitHub 私密漏洞报告（Private Vulnerability Reporting）**

仓库页 → **Security** 标签 → **Report a vulnerability**，只有你和维护者能看到。
(Go to the repo's **Security** tab → **Report a vulnerability**; only you and the
maintainer can see it.)

**备选 / Alternative: 邮件 / email** — `ioulishengyang@163.com`，主题请注明 `[security]`。

报告时请包含 / Please include:

- 受影响的版本或 commit（version / commit affected）
- 复现步骤（steps to reproduce）
- 影响评估（impact assessment）

**请勿在公开 issue / PR / Discussion 中描述漏洞细节。**
(Please do **not** disclose vulnerability details in public issues / PRs / discussions.)

- 确认时效：**7 天内**回复是否受理（Acknowledged within 7 days）。
- 修复或给出缓解措施之前，不会公开披露（No public disclosure until a fix or mitigation is available）。

## 范围说明 / Scope Notes（本项目的特殊风险面 / project-specific attack surface)

本项目通过 InoProShop 的 ScriptEngine 在 IDE 进程内执行 IronPython，天然具备
**读写任意工程文件、编译、把程序下载到 PLC** 的能力，因此：

- `eval_python`（任意 IronPython 代码执行）**默认禁用**，仅在启动命令显式追加
  `--allow-eval` 时可用；开启前请确认客户端可信。
- `--kill-existing-codesys` 默认关闭（会强杀 IDE、丢失未保存工作）。
- MCP 服务端走 stdio、信任本地调用方，**没有任何认证机制** ——
  不要把它暴露给不受信任的客户端，更不要经网络转发。
- 上游 [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP)
  共有的安全问题，请同时/单独报给上游。
