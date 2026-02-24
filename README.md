# OpenClaw Gemini CLI Adapter (openclaw-gemini-cli-adapter)

> *Note: This document was translated from Japanese by an AI (LLM).*

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JA.md)

[![Latest Release](https://img.shields.io/github/v/release/heppoko-wizard/openclaw-gemini-cli-adapter?style=flat-square)](https://github.com/heppoko-wizard/openclaw-gemini-cli-adapter/releases/latest)

An adapter tool designed to directly connect Google's official [Gemini CLI](https://github.com/google/gemini-cli) as the backend inference engine for [OpenClaw](https://github.com/mariozechner/openclaw).
It gives the Gemini CLI itself the aspect of an "autonomous agent," allowing OpenClaw's powerful autonomy and skill sets to be controlled directly from the Gemini CLI.

## Background

Recently, there have been numerous reports of user accounts being suspended due to the widespread use of third-party tools that unofficially divert the Gemini CLI's Google OAuth authentication logic.
This tool was created to build an agent environment safely while avoiding account risks by adopting an architecture where **"the OpenClaw system directly launches and operates the legitimate Gemini CLI command located in the user's local environment,"** rather than diverting authentication.

## Features & Benefits

*   **Completely Free Agent Experience**: No API keys are required. By simply running `gemini login` with your Google account, you can use an autonomous agent for free.
*   **Search Grounding Support**: The "Google Search Grounding" feature built into the Gemini CLI is fully usable, allowing for inferences based on up-to-date information at no cost.
*   **Full Multimodal Support**: Supports direct reading of files such as images, videos, and PDFs for inference.
*   **Real-time Streaming Responses**: Supports SSE streaming where text arrives sequentially from the start of the response, realizing a native chat experience.
*   **Safe Interruption via Stop Command**: If you disconnect using `/stop` during generation, the underlying Gemini CLI process is instantly killed. No zombie processes will remain.
*   **Native Integration of Dynamic MCP Servers**: OpenClaw's powerful suite of tools (`message`, `tts`, `browser`, `web_search`, `sessions_spawn`, etc.) are automatically mapped and provided as **MCP (Model Context Protocol)** servers that the Gemini CLI can natively recognize.
*   **Utilization of OpenClaw Base Skills**: Designed so that OpenClaw's systems like "Heartbeat," file system access, and scheduling work flawlessly with the Gemini CLI.
*   **Isolated and Safe Environment**: Builds an independent temporary environment (`GEMINI_CLI_HOME`) isolated with its own session at runtime, ensuring only permitted skills are safely linked.

## Requirements
*   A command-line environment with basic tools (e.g., `git`, `curl`).
*   A Google account (Browsed-based login is required during setup).
*   *Note: The installer will automatically detect and download/configure missing requirements such as Node.js (v18+) and the OpenClaw core.*

## Installation Mechanism & Location

This adapter is designed as a **portable (self-contained)** tool. It does not copy files to system-wide directories. 
*   **Location**: The folder where you extract the ZIP or `git clone` becomes the installation directory.
*   **Mechanism**: The setup script (`setup.js`) simply installs dependencies locally within this folder and registers its **absolute path** as a shortcut in OpenClaw's configuration (`~/.openclaw/openclaw.json`).
*   **Uninstallation**: Simply delete the folder and remove the reference from `openclaw.json`. No global traces are left except for the Gemini CLI authentication credentials (`~/.gemini`).

## Installation (Quick Start)

The easiest method is to run the bundled automatic setup script.
This script fully automates environment checks, cloning/building OpenClaw, adapter registration (`openclaw.json`), and Gemini API authentication (`gemini login`).

**[⚠️ Important Installation Notes]**
*   **Installation Time:** Because it performs a bulk build of OpenClaw (TypeScript compilation, etc.) and downloads npm packages including the dedicated Gemini CLI, **it can take quite a while (several minutes) depending on your environment.** Even if the terminal seems frozen, do not close it until the completion message appears.
*   **Dedicated Gemini CLI Environment:** To avoid contaminating your system environment, this installer downloads a dedicated `gemini-cli` directly into this repository (`node_modules`) instead of globally, isolating its usage.

### Execution Steps

**If you are already using OpenClaw (Already installed):**
Make sure to move this downloaded `openclaw-gemini-cli-adapter` folder **directly under** your existing `openclaw` folder before running the installation script.
(Example placement: `openclaw/openclaw-gemini-cli-adapter/install.bat`)

**If this is your very first time installing OpenClaw:**
Run the following script in any folder, and the installer will automatically download (git clone) and build OpenClaw.

**Linux / macOS:**
```bash
# Move to this repository folder and run:
chmod +x install.sh
./install.sh
```

**Windows:**
Double-click `install.bat` inside this folder from Explorer, or run the following in Command Prompt:
```cmd
install.bat
```

## Usage

In your OpenClaw settings (`openclaw.json`), switch your main inference engine to the Gemini adapter.

```json
"models": {
  "primary": "gemini-adapter/default"
}
```

After configuration, simply send a message as usual from the OpenClaw CLI or Telegram/Discord interface, and the Gemini CLI will boot in the backend to return a response.

## Architecture

This adapter acts as an OpenAI-compatible HTTP server (port 3972) that translates OpenClaw requests for the Gemini CLI.

Key design features include:

1. **Warm Standby Runner Pool**:
   Upon server startup, `runner-pool.js` pre-launches a single Gemini CLI process (`runner.js`) in the background. When a request is received, it instantly passes the prompt via IPC, reducing startup costs to zero and completely eliminating wait times.
2. **Hybrid Runtime Configuration**:
   The adapter server (`src/server.js`) runs on **Node.js** to reliably detect client disconnections (`res.on('close')`). The Gemini CLI process (`runner.js`) runs on **Bun** for ultra-fast boot times.
3. **System Prompt Relaying**:
   Extracts the dynamically generated context from OpenClaw and passes it to the Gemini CLI via the `GEMINI_SYSTEM_MD` environment variable.


## Limitations & Troubleshooting

*   **API Rate Limits**: If you are using a free Gemini API / Google account, you may hit rate limits (429 Too Many Requests) if there are excessive requests in a short time.
*   **Authentication Expiry**: If your Gemini CLI login session expires, run `npx gemini login` again within this directory (`openclaw-gemini-cli-adapter`) to re-authenticate.
*   **Disabled Tools and Reasons**: The following tools are currently excluded due to conflict avoidance or structural constraints:
    *   **File Operation/Execution (`read`, `write`, `edit`, `exec`, `bash`, `process`)**: Excluded because their names and functions conflict with the Gemini CLI's standard tools (host permissions).
    *   **Hint**: The standard Gemini `google_web_search` natively handles everything from searching to page reading (grounding), powerfully replacing most use cases for OpenClaw's `web_search` / `web_fetch`.

## Development Roadmap

Currently, this adapter is running stably with its core features, including real-time streaming, tool integration, and connection stop functions. For unaddressed issues or improvement plans, please refer to [backlog.md](docs/openclaw_geminicli_integration/openclaw_geminicli_integration/backlog.md).

Major planned updates include:

*   **Advanced Context Pruning for Multi-Sessions:**
   Sophisticated state management to perfectly synchronize the gap between Gemini CLI's internal history and OpenClaw's context when hitting token limits (Garbage Collection).
*   **Windows Support (Creation of `start.bat`):**
   Currently, only a Unix `start.sh` is provided. Full portability for Windows environments is planned.

## Disclaimer

This software is an unofficial community-made adapter and is not affiliated with, endorsed, or supported by Google. Use of the Gemini CLI and associated Google accounts is at your own risk. The authors are not responsible for any account suspensions, data loss, or other damages resulting from the use of this software. It is provided "as is" without any warranty.

## Uninstallation

To remove this adapter and return to your original OpenClaw state, follow these steps:

1. Open `~/.openclaw/openclaw.json` and revert `models.primary` to its original value (e.g., `anthropic-messages/claude-sonnet-3-5`).
2. Delete the `"gemini-adapter"` block that was added to `cliBackends` in `openclaw.json`.
3. Delete the repository folder (`openclaw-gemini-cli-adapter`). This leaves zero impact on your global system state and uninstalls the adapter cleanly.
