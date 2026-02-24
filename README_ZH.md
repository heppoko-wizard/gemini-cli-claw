# OpenClaw Gemini CLI Adapter (openclaw-gemini-cli-adapter)

> *注：本文件由 AI (LLM) 从日文翻译而来。*

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JA.md)

作为一个适配器工具，它旨在将 Google 官方的 [Gemini CLI](https://github.com/google/gemini-cli) 直接连接到 [OpenClaw](https://github.com/mariozechner/openclaw) 作为其后端的推理引擎。
它赋予了 Gemini CLI 本身作为“自主驱动型代理”的特性，并让您能够直接从 Gemini CLI 操控 OpenClaw 强大的自主能力和技能组。

## 开发背景

近年来，由于非官方滥用 Gemini CLI 的 Google OAuth 认证逻辑的第三方工具泛滥，导致多起用户账号被封禁的案例。
本工具的制作初衷正是为了规避此类“认证滥用”风险。通过采用 **“由 OpenClaw 系统直接启动并操控用户本地环境中正规的 Gemini CLI 命令”** 这一架构，在规避账号风险的同时安全地构建代理环境。

## 功能与优势

*   **完全免费的智能代理体验**：无需 API 密钥。只需使用您的 Google 账号执行 `gemini login`，即可免费使用自主驱动型代理。
*   **支持搜索增强 (Grounding)**：能够无缝使用 Gemini CLI 原生的“Google 搜索增强”功能，免费根据最新网络信息进行推理。
*   **完美支持多模态输入**：支持直接读取图像、视频、PDF 等文件进行推理。
*   **实时流式响应**：支持 SSE 流传输，字符从响应开始时即顺序送达，实现原生且极致流畅的聊天体验。
*   **通过 Stop 命令安全中断**：如果您在生成过程中使用 `/stop` 中断连接，后台运行的 Gemini CLI 进程也会被瞬间强行终止。保证不会残留任何僵尸进程。
*   **原生集成动态 MCP 服务器**：自动将 OpenClaw 强大的工具组（`message`, `tts`, `browser`, `web_search`, `sessions_spawn` 等）映射为 Gemini CLI 能够原生识别的 **MCP (Model Context Protocol)** 服务器并提供调用。
*   **利用 OpenClaw 底层技能**：其设计让 OpenClaw 的“Heartbeat（自律心跳）”、文件系统访问、定时任务等核心系统可在 Gemini CLI 中完美运行。
*   **独立的沙盒安全环境**：运行时将构建带有独立会话和隔离的临时环境（`GEMINI_CLI_HOME`），仅安全地链接经许可的技能。

## 运行要求
*   命令行环境及基础工具（如 `git`, `curl` 等）。
*   Google 账号（在设置时需要通过浏览器进行登录验证）。
*   *注意：安装程序会自动检测并下载配置缺少的运行依赖，例如 Node.js (v18+) 及 OpenClaw 主程序。*

## 安装 (快速开始)

最简单的方法是直接运行附带的全自动安装脚本。
此脚本将全自动代劳环境检查、OpenClaw 主程序的克隆与构建、适配器配置注册 (`openclaw.json`)，以及 Gemini API 的授权登录 (`gemini login`) 等全部流程。

**【⚠️ 安装时的重要须知】**
*   **安装耗时较长：** 由于需要合并执行 OpenClaw 本体构建（TypeScript 编译等）以及下载专用的 Gemini CLI npm 包，**根据您的网络环境，可能会耗费数分钟的较长时间。** 即使终端看似停滞，也请耐心等待，直到输出成功的完成提示之前切勿关闭窗口。
*   **专用的 Gemini CLI 环境：** 为了不污染您的系统全局环境，本安装器不会进行全局安装，而是直接将本工具专用的 `gemini-cli` 下载至本代码库目录（`node_modules`）中进行隔离使用。

### 运行步骤

**如果您正在使用 OpenClaw（已安装）：**
请务必先将下载好的 `openclaw-gemini-cli-adapter` 文件夹整体移动至您现有的 `openclaw` 文件夹的**正下方**，然后再执行安装脚本。
（位置示例：`openclaw/openclaw-gemini-cli-adapter/install.bat`）

**如果您是首次接触并未安装过 OpenClaw：**
请在任意文件夹中运行以下脚本，安装程序会自动完成下载 (git clone) 及 OpenClaw 本体的构建工作。

**Linux / macOS:**
```bash
# 进入该代码库文件夹并执行：
chmod +x install.sh
./install.sh
```

**Windows:**
请在资源管理器中双击此文件夹内的 `install.bat`，或在命令提示符中执行以下命令。
```cmd
install.bat
```

## 使用方法

请在 OpenClaw 的设置文件 (`openclaw.json`) 中，将主力推理引擎切换至 Gemini 适配器。

```json
"models": {
  "primary": "gemini-adapter/default"
}
```

配置完成后，像往常一样从 OpenClaw CLI 或 Telegram/Discord 界面发送消息即可，后台将启动 Gemini CLI 配合并返回响应。

## 架构说明

本适配器作为一个兼容 OpenAI 的 HTTP 服务器（端口 3972）运行，负责将 OpenClaw 的请求转换给 Gemini CLI。

主要的设计特征如下：

1. **Warm Standby Runner Pool (热备池)**:
   `runner-pool.js` 会在服务器启动的同时，在后台预启动一个 Gemini CLI 进程（`runner.js`）作为待机。当接收到请求时，只需通过 IPC 传递提示词即可瞬间开始处理，消除了冷启动成本，使得响应延迟几乎降至为零。
2. **混合运行时配置**:
   适配器服务器 (`src/server.js`) 运行在 **Node.js** 环境上，以确保稳定地检测到客户端连接断开 (`res.on('close')`)。而 Gemini CLI 进程 (`runner.js`) 为了追求极致的启动速度，使用 **Bun** 运行。
3. **系统提示词中继**:
   提取 OpenClaw 动态生成的上下文内容，并通过 `GEMINI_SYSTEM_MD` 环境变量的途径传递给 Gemini CLI。


## 限制条件与故障排除

*   **API 的调用限制 (Rate Limit)**：若您使用的是免费的 Gemini API 或 Google 账号，在短时间内高频发出的请求可能会触发速率限制（429 Too Many Requests）。
*   **凭证过期**：如果您的 Gemini CLI 登录会话过期，请重新进入此代码库目录（`openclaw-gemini-cli-adapter` 内）执行 `npx gemini login` 重新授权。
*   **不可用的工具及原因**：以下工具因冲突或架构限制目前已被剔除。
    *   **文件操作与执行类 (`read`, `write`, `edit`, `exec`, `bash`, `process`)**：由于与 Gemini CLI 标配工具功能重叠且名称冲突（会干涉宿主权限）而被移除。
    *   **提示**：Gemini 标配的 `google_web_search` 能够将从搜索到分析网页（Grounding）合并为一刀切操作，可极其强力地替代绝大部分 OpenClaw 原生 `web_search` / `web_fetch` 的作用。

## 开发路线图 (Roadmap)

目前，本适配器的核心功能（包括实时流传输、工具集成以及强行断开连接等）已稳定且无缝运转。关于尚未着手的课题或需要改进的案卷，请参考 [backlog.md](docs/openclaw_geminicli_integration/openclaw_geminicli_integration/backlog.md)。

后续主要的更新与修复计划包括：

*   **多会话高级上下文修剪 (Pruning)**：
    为了在触及 Token 上限时更好地处理垃圾回收机制（Garbage Collection），正在研究完美同步修正 Gemini CLI 会话与 OpenClaw 上下文的历史分歧的进阶状态管理系统。
*   **Windows 兼容计划 (完成 `start.bat`)**：
    目前仅提供适用于 Unix 系统的 `start.sh`。计划让其在 Windows 生态下实现完全便携的运转体验。

## 卸载指引

若需移除本适配器并恢复至 OpenClaw 原有状态，请执行以下步骤：

1. 打开 `~/.openclaw/openclaw.json`，将 `models.primary` 还原为您原始的值（例如：`anthropic-messages/claude-sonnet-3-5` 等）。
2. 删除 `openclaw.json` 中 `cliBackends` 节点下新增的 `"gemini-adapter"` 设定块。
3. 删除整个仓库文件夹 (`openclaw-gemini-cli-adapter`)。此操作即可做到纯净卸载，丝毫不会残留系统级全局垃圾。
