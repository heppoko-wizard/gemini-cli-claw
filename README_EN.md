# OpenClaw Gemini Gateway (gemini-cli-claw) v0.1

A dedicated gateway (adapter) designed to **directly and securely** connect the powerful autonomous capabilities of OpenClaw with Google's official [Gemini CLI](https://github.com/google-gemini/gemini-cli).

**Supported OS: Linux / macOS / Windows**  
*(Note: As of v0.1, fully verified testing has only been conducted on Linux. While mechanisms for Windows and macOS are implemented, you may encounter unexpected behavior.)*

## 🌟 Background and Purpose
Recently, "token stealers" that abuse authentication by silently extracting internal Google OAuth tokens from Gemini (or similar services) to use in unofficial tools have become a widespread issue. In response, Google has started actively detecting these unauthorized access patterns, leading to **an increasing number of complete Google account bans for users caught exploiting these tokens.**

This project **completely discards the dangerous approach of "authentication hijacking."** Instead, it introduces a robust architecture where the OpenClaw system directly launches and commands the **authentic Gemini CLI process already safely installed in the user's environment** as its backend.
Because all reasoning happens exclusively through the official tool, you can combine OpenClaw's autonomous driving features with Gemini's immense power **with zero risk of account suspension.**

## ✨ Key Benefits and Features

### 1. Build a Powerful AI Assistant for Free
No API key (pay-as-you-go) is required. Simply log into the official Gemini CLI with your standard Google account to experience a fully autonomous agent environment **completely for free.**

### 2. Built-in Google Search Grounding
Because it relies directly on the official Gemini CLI, it naturally leverages Gemini's built-in **Google Search (Grounding)** capabilities without requiring paid API access. The agent can seamlessly access the latest real-time web information while executing tasks.

### 3. Multimodal Support
Fully inherits Gemini's multimodal capabilities. Complex reasoning tasks, such as reading and analyzing local images, are supported out-of-the-box.

### 4. Full Compatibility with OpenClaw Skills & Tools
Skills (defined in `SKILL.md`) and toolsets configured within OpenClaw are securely and reliably passed down to the Gemini CLI through this adapter.
This repository evolves the Gemini CLI from a simple chat interface into a true **"Autonomous Agent"** capable of automatic file editing, command execution, and heartbeat-driven scheduled tasks.

### 5. "Absolute Skill Isolation" via Virtual Home Directories
Due to the design of the Gemini CLI, it ordinarily forces the loading of all global skills present on the local machine. To combat context pollution, this adapter dynamically generates a temporary **Virtual Home Directory (GEMINI_CLI_HOME)** on every execution. Only resources that pass OpenClaw's sandbox validation are injected into this directory via symbolic links/junctions. This ensures extremely secure and pristine agent control.

### 6. "Prompt Self-Optimization" by the AI Itself
The core structure of the system prompt is separated into an independent Markdown file (`adapter-template.md`). This allows for dynamic workflows where you instruct the Gemini CLI to "read your own prompt configuration file and overwrite it to make yourself a better autonomous agent." **The AI effectively analyzes its own behavioral rules and evolves itself without humans writing a single line of code.**

## 🚀 Architecture

```text
OpenClaw Daemon
    │  (stdin/stdout)
    ▼
adapter.js          ← Translates OpenClaw context to Gemini CLI prompt, launches isolated via env vars
    │  (Child Process)
    ▼
Gemini CLI          ← Executes reasoning and invokes tools as the official app
    │  (MCP stdio)
    ▼
mcp-server.mjs      ← Exposes OpenClaw tools (e.g. Slack, Scheduler) back to Gemini CLI via MCP
    │  (import)
    ▼
OpenClaw tools
```

## 📁 File Structure

| File | Role |
|---|---|
| `adapter.js` | The main bridge between OpenClaw ↔ Gemini CLI (CJS) |
| `adapter-template.md` | System prompt template for Gemini CLI (AI self-optimizable) |
| `mcp-server.mjs` | Server that exposes OpenClaw native tools via MCP (ESM) |
| `setup.js` | Cross-platform interactive installer |
| `package.json` | Dependencies (`@google/gemini-cli`, `@modelcontextprotocol/sdk`) |

## 📥 Ultra-Easy Installation (Zero Prep Required)

To shrink the user setup burden to absolute zero, this gateway packages a powerful automated deployment script (`install.sh` / `setup.js`).
*Even if Node.js is not present on your system, `install.sh` will auto-detect this and install it via NVM. You don't need to manually install anything beforehand!*

**Setup Instructions**

### 🍏🐧 macOS / Linux

```bash
# 1. Download and enter the repository
git clone <openclaw-repo>
cd openclaw/gemini-cli-claw

# 2. Run the fully automated installer
./install.sh
```

### 🪟 Windows

```cmd
:: 1. Download and enter the repository
git clone <openclaw-repo>
cd openclaw\gemini-cli-claw

:: 2. Run the fully automated installer
install.bat
```

---

Upon executing, the installer will automatically and interactively handle the following steps:
1. **Node.js validation & automatic installation** (if missing)
2. Language selection (English/Japanese)
3. Check OpenClaw core build status & perform automatic build
4. Install npm dependencies for this adapter
5. Auto-register and configure the `gemini-adapter` backend inside `~/.openclaw/openclaw.json`
6. Validate Gemini CLI authentication and launch the interactive auto-login (browserless QR login supported)

## ⚙️ Detailed Specs & Integrating with Existing Environments

If you already have an existing OpenClaw repository on your machine, here are the exact integration specs:

### 1. Folder Placement
This repository folder (`gemini-cli-claw`) must be placed **directly under the root directory of OpenClaw.**
The installer (`setup.js`) assumes that its parent directory (`..`) is the OpenClaw root when checking for builds.

✅ **Correct Placement Example**:
```text
openclaw/
├── src/
├── package.json
└── gemini-cli-claw/   <-- Place it here
    ├── adapter.js
    ├── install.sh
    └── package.json
```

### 2. Automatic Changes to Configurations (`openclaw.json`)
When the installer runs, it resolves absolute paths and safely appends the following provider settings to your global OpenClaw configuration file (`~/.openclaw/openclaw.json`):

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "gemini-adapter": {
          "command": "node",
          "input": "stdin",
          "output": "text",
          "systemPromptArg": "--system",
          "args": [
            "/ABSOLUTE_PATH/openclaw/gemini-cli-claw/adapter.js",
            "--session-id",
            "{sessionId}",
            "--allowed-skills",
            "{allowedSkillsPaths}"
          ],
          "resumeArgs": [
            /* Same as above */
          ]
        }
      }
    }
  }
}
```
*Thanks to this addition, OpenClaw learns how to seamlessly summon the Gemini adapter. It does not destroy or overwrite your existing backend definitions.*

## 🎮 Usage

### One-Off Test Run
To verify that the Gemini CLI connection is working correctly, you can run a quick test from the OpenClaw root directory (`openclaw/`) using the `--local` flag:

```bash
node scripts/run-node.mjs agent -m "Hello" --local
```

### Set as the Default Permanent Reasoning Engine
To make Gemini your permanent default provider in OpenClaw, edit `~/.openclaw/openclaw.json` to append the default provider key as shown below:

```json
{
  "agents": {
    "defaults": {
      "provider": "gemini-adapter"
    }
  }
}
```

By applying this setting, the next time your OpenClaw daemon starts, **all chat channels (Telegram, Signal, etc.), Cron jobs, and session-thinking workflows will permanently and freely route through the incredibly powerful `Gemini CLI`.**

## MCP Tools Provided

Native OpenClaw tools exposed to the Gemini CLI (via `mcp-server.mjs`):

| Tool | Description |
|---|---|
| `message` | Send messages to Discord / Telegram etc. |
| `cron` | Scheduled task execution & reminders |
| `sessions_send` | Send messages to different active sessions |
| `sessions_spawn` | Launch independent background subagents |
| `subagents` | Manage active subagents |
| `web_search` | Search the web using Brave Search API |
| `web_fetch` | Fetch raw content from URLs |
| `memory_search` | Semantic search over long-term memory |
| `gateway` | Configure & restart the OpenClaw gateway |

Tools native to the Gemini CLI that heavily overlap with OpenClaw (such as `read`, `write`, `exec`) are intentionally excluded to prevent conflicts.

## Customization

### Editing the System Prompt
You can completely customize the persona and rules of the Gemini CLI AI by editing `adapter-template.md` directly.
Additionally, you can leverage Gemini's intelligence by instructing it to modify its own `adapter-template.md` file (Self-Optimization mode).

### Available Prompt Variables

| Variable | Injected Content |
|---|---|
| `{{PROVIDED_SYSTEM_PROMPT}}` | The dynamic core context generated by OpenClaw |
| `{{WORKSPACE}}` | Absolute path of your current working directory |
| `{{HEARTBEAT_PROMPT}}` | Operational directives mapped for the current heartbeat |
| `{{HEARTBEAT_CONTENT}}` | Content of your local HEARTBEAT.md |
