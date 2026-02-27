#!/usr/bin/env node
/**
 * setup.js — OpenClaw Gemini Backend Interactive Installer
 *
 * 対話型のインストーラーです。言語選択、OpenClaw本体の状態確認と自動ビルド、
 * 依存関係のインストール、そしてGemini APIの認証確認までを一貫して行います。
 */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const SCRIPT_DIR = __dirname;
let OPENCLAW_ROOT = SCRIPT_DIR;
let PLUGIN_DIR = path.join(SCRIPT_DIR, "openclaw-gemini-cli-adapter");

// If executed inside the dev plugin repo itself, fix the paths
if (path.basename(SCRIPT_DIR) === "openclaw-gemini-cli-adapter" || path.basename(SCRIPT_DIR) === "gemini-cli-claw") {
    OPENCLAW_ROOT = path.join(SCRIPT_DIR, "..");
    PLUGIN_DIR = SCRIPT_DIR;
}

const SERVER_JS = path.join(PLUGIN_DIR, "src", "server.js");
const OPENCLAW_CONFIG = path.join(os.homedir(), ".openclaw", "openclaw.json");
const GEMINI_CREDS_DIR = path.join(PLUGIN_DIR, "src", ".gemini");

// Messages vocabulary
const MSG = {
    ja: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "OpenClaw Gemini Backend セットアップへようこそ！",
        checkOpenclaw: "OpenClaw 本体のインストール状態をチェックしています...",
        notFoundOpenclaw: "OpenClaw 本体が見つかりません。",
        suggestClone: "最新安定版の OpenClaw をダウンロードしますか？ (Y/n): ",
        cloning: "OpenClaw の最新リリースを確認中...",
        cloneFail: "エラー: OpenClaw のダウンロードに失敗しました。",
        cloneSuccess: "✓ OpenClaw のダウンロード完了",
        setupAborted: "セットアップを中断しました。",
        relocationTip: "すでに OpenClaw がインストールされている場合は、この '{RENAME_ME}' フォルダを OpenClaw のルートディレクトリ直下に配置してから再度実行してください。",
        placementEx: "配置例:",
        installOpenclaw: "OpenClaw がビルドされていないようです。ビルドを実行しますか？ (Y/n): ",
        buildingOpenclaw: "OpenClaw をビルド中 (pnpm が必要な場合は自動インストール後にビルド)...",
        buildOpenclawFail: "エラー: OpenClaw のビルドに失敗しました。セットアップを継続できません。",
        buildOpenclawSuccess: "✓ OpenClaw のビルド完了",
        checkGeminiDep: "Gemini Backend (このフォルダ) の npm パッケージをインストール中...",
        npmFail: "エラー: npm install に失敗しました。",
        installDepSuccess: "✓ npm 依存関係のインストール完了",
        syncModels: "Gemini モデルを OpenClaw に同期中...",
        syncFail: "警告: Gemini モデルの同期に失敗しました。モデルが OpenClaw UI に表示されない可能性があります。",
        syncSuccess: "✓ モデルの同期完了",
        registerAdapter: "openclaw.json に gemini-adapter を登録しています...",
        registerAdapterSuccess: "✓ gemini-adapter の登録完了",
        checkAuth: "Gemini CLI の認証状況をチェックしています...",
        authNeeded: "Gemini API の認証が見つかりません。今すぐログインしますか？ (Y/n): ",
        authStart: "認証を開始します。ターミナルに表示される指示に従ってログインしてください...",
        authSuccess: "✓ Gemini 認証完了",
        authMissingTip: "情報: 認証資格情報がまだ見つかりません。後で手動で `npx @google/gemini-cli login` を実行する必要があるかもしれません。",
        finish: "セットアップが完了しました！",
        configTip: "OpenClaw でこのアダプタを使用するには、~/.openclaw/openclaw.json に以下のように設定してください:",
        tryIt: "さっそく OpenClaw を起動して Gemini CLI と会話してみましょう！",
        versionNote: "ℹ️ 注意: OpenClaw と Gemini CLI はインストール時点の最新安定版が導入されました。もし不具合が見られる場合は、README に記載された「動作確認環境」のバージョンにダウングレードすることでテスト済み環境を再現できます。",
        intro: `=================================================
 OpenClaw × Gemini CLI アダプタ セットアップ
=================================================

このインストーラーを実行すると、以下の設定が行われます。

【インストールされるもの】
  1. OpenClaw 本体（AI エージェントのゲートウェイ）
     - Telegram / WhatsApp などのメッセンジャーに対応する
     - プロセス: Node.js、ポート 18789

  2. Gemini CLI アダプタ（本ツール）
     - OpenClaw から Gemini CLI へのリクエストを仲介する
     - プロセス: Node.js、ポート 3972
     - Gemini CLI はアダプタ内にサブプロセスとして呼び出される

【起動後の構成イメージ】
  あなた（Telegram）
       ↓
  OpenClaw Gateway（ポート: 18789）
       ↓ OpenAI互換 API
  Gemini CLI アダプタ（ポート: 3972）
       ↓ サブプロセス
  Gemini CLI → Google Gemini API（クラウド）

【認証について】
  Gemini API の認証情報はこのアダプタフォルダ内（src/.gemini）に
  隔離して保存されます。既存の Gemini CLI の設定には影響しません。

【起動時の注意】
  アダプタを先に起動（./openclaw-gemini-cli-adapter/start.sh）してから、
  OpenClaw を起動（npm run start）してください。`,
        warning: `=================================================
⚠️  このソフトウェアは現在ベータ版です。
⚠️  デフォルトで YOLO モードが有効です。

  YOLO モードとは：
  Gemini CLI が「ファイルの作成・編集・削除」「コマンドの実行」などの
  操作を、確認プロンプトなしに自動で行うモードです。

  以下のような環境では絶対に実行しないでください：
  ✗ 重要な業務データ・本番環境サーバー
  ✗ 破壊的な変更が許されないシステム
  ✗ 不特定多数がアクセスできる共有サーバー

  必ず：
  ✓ テスト環境または専用の隔離環境で動かす
  ✓ 実行ログを定期的に確認する
=================================================`
    },
    en: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "Welcome to OpenClaw Gemini Backend Setup!",
        checkOpenclaw: "Checking OpenClaw base installation...",
        notFoundOpenclaw: "OpenClaw repository not found in parent directory.",
        suggestClone: "Download the latest stable release of OpenClaw? (Y/n): ",
        cloning: "Checking OpenClaw latest release...",
        cloneFail: "Error: Failed to download OpenClaw.",
        cloneSuccess: "✓ OpenClaw downloaded.",
        setupAborted: "Setup aborted.",
        relocationTip: "If OpenClaw is already installed, please move this '{RENAME_ME}' folder directly into your OpenClaw root directory and run again.",
        placementEx: "Example:",
        installOpenclaw: "OpenClaw does not appear to be built. Build it now? (Y/n): ",
        buildingOpenclaw: "Building OpenClaw (installing pnpm if needed, then npm install && pnpm build)...",
        buildOpenclawFail: "Error: OpenClaw build failed. Setup cannot continue.",
        buildOpenclawSuccess: "✓ OpenClaw build complete",
        checkGeminiDep: "Installing npm dependencies for Gemini Backend...",
        npmFail: "Error: npm install failed.",
        installDepSuccess: "✓ npm dependencies installed",
        syncModels: "Syncing Gemini models to OpenClaw...",
        syncFail: "Warning: Failed to sync Gemini models. Models might not appear in OpenClaw UI.",
        syncSuccess: "✓ Models synced",
        registerAdapter: "Registering gemini-adapter in openclaw.json...",
        registerAdapterSuccess: "✓ gemini-adapter registered",
        checkAuth: "Checking Gemini CLI authentication...",
        authNeeded: "Gemini API authentication not found. Login now? (Y/n): ",
        authStart: "Starting authentication. Please follow the instructions to login...",
        authSuccess: "✓ Gemini authentication complete",
        authMissingTip: "Info: Authentication credentials still not found. You may need to manually run `npx @google/gemini-cli login` later.",
        finish: "Setup complete!",
        configTip: "To use this adapter in OpenClaw, please add the following configuration to your ~/.openclaw/openclaw.json:",
        tryIt: "Start OpenClaw now and try chatting with Gemini CLI!",
        versionNote: "ℹ️ Note: The latest stable versions of OpenClaw and Gemini CLI have been installed. If you encounter any issues, please check the 'Tested With' section in the README and downgrade to the verified versions to reproduce the test environment.",
        intro: `=================================================
 OpenClaw x Gemini CLI Adapter Setup
=================================================

This installer will configure the following:

[What Gets Installed]
  1. OpenClaw (AI Agent Gateway)
     - Handles messages from Telegram / WhatsApp, etc.
     - Process: Node.js, port 18789

  2. Gemini CLI Adapter (this tool)
     - Bridges requests from OpenClaw to Gemini CLI
     - Process: Node.js, port 3972
     - Gemini CLI is invoked as a subprocess inside the adapter

[How It Works After Setup]
  You (via Telegram)
       ↓
  OpenClaw Gateway (port: 18789)
       ↓  OpenAI-compatible API
  Gemini CLI Adapter (port: 3972)
       ↓  subprocess
  Gemini CLI  →  Google Gemini API (cloud)

[Authentication]
  Your Gemini API credentials are stored in isolation within
  this adapter folder (src/.gemini). Your existing global
  Gemini CLI settings are NOT affected.

[How to Start]
  1. Start the adapter first: ./openclaw-gemini-cli-adapter/start.sh
  2. Then start OpenClaw: npm run start`,
        warning: `=================================================
⚠️  This software is currently in BETA.
⚠️  YOLO mode is ENABLED BY DEFAULT.

  What is YOLO mode:
  Gemini CLI will automatically perform file operations
  (create, edit, delete) and run commands WITHOUT asking
  for confirmation.

  DO NOT run this software on:
  ✗ Production servers or systems with critical data
  ✗ Systems where destructive changes cannot be tolerated
  ✗ Shared servers accessible by others

  ALWAYS:
  ✓ Use a test environment or dedicated isolated machine
  ✓ Monitor execution logs regularly
=================================================`
    },
    zh: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "欢迎使用 OpenClaw Gemini 后端安装程序！",
        checkOpenclaw: "正在检查 OpenClaw 本体的安装状态...",
        notFoundOpenclaw: "未发现 OpenClaw 本体。",
        suggestClone: "是否下载最新稳定版的 OpenClaw？ (Y/n): ",
        cloning: "正在查询 OpenClaw 最新发布版本...",
        cloneFail: "错误：下载 OpenClaw 失败。",
        cloneSuccess: "✓ OpenClaw 下载完成",
        setupAborted: "安装已中止。",
        relocationTip: "如果已经安装了 OpenClaw，请将此 '{RENAME_ME}' 文件夹直接移动到 OpenClaw 根目录下并重新运行。",
        placementEx: "配置示例：",
        installOpenclaw: "OpenClaw 似乎尚未构建。现在构建吗？ (Y/n): ",
        buildingOpenclaw: "正在构建 OpenClaw (如需将先安装 pnpm，然后执行 npm install && pnpm build)...",
        buildOpenclawFail: "错误：OpenClaw 构建失败。无法继续安装。",
        buildOpenclawSuccess: "✓ OpenClaw 构建完成",
        checkGeminiDep: "正在安装 Gemini 后端（本文件夹）的 npm 依赖包...",
        npmFail: "错误：npm install 失败。",
        installDepSuccess: "✓ npm 依赖项安装完成",
        syncModels: "正在将 Gemini 模型同步到 OpenClaw...",
        syncFail: "警告：同步 Gemini 模型失败。模型可能不会出现在 OpenClaw UI 中。",
        syncSuccess: "✓ 模型同步完成",
        registerAdapter: "正在 openclaw.json 中注册 gemini-adapter...",
        registerAdapterSuccess: "✓ gemini-adapter 注册完成",
        checkAuth: "正在检查 Gemini CLI 的身份验证状态...",
        authNeeded: "未发现 Gemini API 身份验证。现在登录吗？ (Y/n): ",
        authStart: "开始身份验证。请按照终端显示的说明进行登录...",
        authSuccess: "✓ Gemini 身份验证完成",
        authMissingTip: "提示：仍未发现身份验证凭据。您稍后可能需要手动运行 `npx @google/gemini-cli login`。",
        finish: "安装完成！",
        configTip: "如果要在 OpenClaw 中使用此适配器，请在您的 ~/.openclaw/openclaw.json 中添加以下配置：",
        tryIt: "现在启动 OpenClaw，尝试与 Gemini CLI 聊天吧！",
        versionNote: "ℹ️ 提示：安装程序已为您下载最新稳定版的 OpenClaw 和 Gemini CLI。如果使用中出现问题，建议您查看 README 中的“测试环境”章节，将组件降级到已验证的版本。",
        intro: `=================================================
 OpenClaw x Gemini CLI 适配器 安装程序
=================================================

本安装程序将进行以下配置：

【安装内容】
  1. OpenClaw（AI 助理网关）
     - 接收来自 Telegram / WhatsApp 等消息软件的信息
     - 进程: Node.js，端口 18789

  2. Gemini CLI 适配器（本工具）
     - 在 OpenClaw 与 Gemini CLI 之间传递请求
     - 进程: Node.js，端口 3972
     - Gemini CLI 以子进程形式在适配器内被调用

【启动后的系统结构】
  您（通过 Telegram）
       ↓
  OpenClaw 网关（端口: 18789）
       ↓  OpenAI 兼容 API
  Gemini CLI 适配器（端口: 3972）
       ↓  子进程
  Gemini CLI  →  Google Gemini API（云端）

【关于身份验证】
  您的 Gemini API 凭证将被隔离保存在本工具文件夹内
  （src/.gemini），不会影响您现有的全局 Gemini CLI 配置。

【启动顺序】
  1. 先启动适配器: ./openclaw-gemini-cli-adapter/start.sh
  2. 再启动 OpenClaw: npm run start`,
        warning: `=================================================
⚠️  本软件目前处于 Beta 测试阶段。
⚠️  默认启用 YOLO 模式。

  什么是 YOLO 模式：
  Gemini CLI 将在不提示确认的情况下，自动执行文件的
  创建、编辑、删除以及命令执行等操作。

  请勿在以下环境中运行：
  ✗ 生产服务器或包含重要数据的系统
  ✗ 不允许破坏性改动的系统
  ✗ 多人共享访问的服务器

  请务必：
  ✓ 在测试环境或专用隔离环境中使用
  ✓ 定期检查执行日志
=================================================`
    }
};

let L = MSG.en; // Default language fallback

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function runCommand(command, cwd) {
    return spawnSync(command, { cwd, shell: true, stdio: "inherit" });
}

/**
 * Ensure pnpm is available. If not, install it globally via npm.
 */
function ensurePnpm() {
    const check = spawnSync("pnpm", ["--version"], { shell: true, stdio: "pipe" });
    if (check.status === 0) return true; // already available
    console.log("[pnpm] pnpm not found. Installing globally via npm...");
    const install = spawnSync("npm", ["install", "-g", "pnpm"], { shell: true, stdio: "inherit" });
    return install.status === 0;
}

/**
 * Build OpenClaw. Because OpenClaw uses pnpm scripts internally,
 * we must use pnpm for building. npm is used only for the initial
 * dependency installation (pnpm install also works).
 */
function buildOpenclaw(cwd) {
    // Install deps
    const depRes = spawnSync("npm", ["install"], { cwd, shell: true, stdio: "inherit" });
    if (depRes.status !== 0) return depRes;
    // Ensure pnpm exists before running build script
    if (!ensurePnpm()) {
        return { status: 1 };
    }
    // Run build via pnpm (openclaw's package.json build script calls pnpm internally)
    return spawnSync("npm", ["run", "build"], { cwd, shell: true, stdio: "inherit" });
}

async function main() {
    // 0. Language selection (from install.sh via SETUP_LANG env var)
    const envSetupLang = process.env.SETUP_LANG;
    const envLang = (process.env.LANG || "").toLowerCase();
    
    if (envSetupLang) {
        if (envSetupLang === 'ja') L = MSG.ja;
        else if (envSetupLang === 'zh') L = MSG.zh;
        else L = MSG.en;
    } else {
        // Fallback: auto-detect from system locale, or ask interactively
        if (envLang.startsWith("ja")) {
            L = MSG.ja;
        } else if (envLang.startsWith("zh")) {
            L = MSG.zh;
        }

        console.log("=================================================");
        const langInput = await question(L.selectLang);
        if (langInput.trim() === '2') {
            L = MSG.ja;
        } else if (langInput.trim() === '3') {
            L = MSG.zh;
        } else if (langInput.trim() === '1') {
            L = MSG.en;
        }
    }

    console.log("\n" + L.welcome);
    console.log("=================================================\n");

    // --- Show intro & warning only if NOT already shown by install.sh ---
    if (!process.env.SETUP_SKIP_INTRO) {
        console.log(L.intro);
        console.log("");
        console.log(L.warning);
        console.log("");
    }

    console.log("[1/4] " + L.checkOpenclaw);
    let openclawNeedsBuild = false;
    
    // Check if OpenClaw exists (checking for package.json in the parent directory)
    // If we are cloned as a standalone repo, parent might not be openclaw.
    const openclawPackageJson = path.join(OPENCLAW_ROOT, "package.json");
    let isOpenclawPresent = false;
    
    if (fs.existsSync(openclawPackageJson)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(openclawPackageJson, "utf8"));
            if (pkg.name === "openclaw") {
                isOpenclawPresent = true;
            }
        } catch (e) { }
    }

    if (!isOpenclawPresent) {
        console.log("[!] " + L.notFoundOpenclaw);
        console.log(L.cloning);

        // Try to fetch the latest stable release from GitHub API
            let downloadUrl = null;
            let releaseTag = null;
            try {
                const https = require('https');
                const releaseInfo = await new Promise((resolve, reject) => {
                    https.get({
                        hostname: 'api.github.com',
                        path: '/repos/openclaw/openclaw/releases/latest',
                        headers: { 'User-Agent': 'openclaw-gemini-cli-adapter-setup' }
                    }, (res) => {
                        let body = '';
                        res.on('data', chunk => { body += chunk; });
                        res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
                    }).on('error', reject);
                });
                releaseTag = releaseInfo.tag_name;
                if (releaseInfo.zipball_url) {
                    downloadUrl = releaseInfo.zipball_url;
                }
            } catch (e) {
                console.log('[setup] Could not fetch release info, will fall back to git clone.');
            }

            if (downloadUrl && releaseTag) {
                console.log(`  Found stable release: ${releaseTag}`);
                console.log(`  Downloading: ${downloadUrl}`);
                const zipPath = path.join(SCRIPT_DIR, 'openclaw-release.zip');

                // Download the ZIP
                const dlRes = runCommand(`curl -L -o "${zipPath}" "${downloadUrl}"`, SCRIPT_DIR);
                if (dlRes.status !== 0) {
                    console.error('[!] Download failed, falling back to git clone...');
                    downloadUrl = null; // fall through to git clone
                } else {
                    // Unzip
                    const tmpExtractDir = path.join(SCRIPT_DIR, 'openclaw-tmp-extract');
                    fs.mkdirSync(tmpExtractDir, { recursive: true });
                    const unzipRes = runCommand(`unzip -q "${zipPath}" -d "${tmpExtractDir}"`, SCRIPT_DIR);
                    try { fs.rmSync(zipPath); } catch(_) {}
                    
                    if (unzipRes.status !== 0) {
                        console.error('[!] Unzip failed, falling back to git clone...');
                        downloadUrl = null;
                        try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch(_) {}
                    } else {
                        // GitHub's zipball creates a folder like 'openclaw-openclaw-xxxxxxx'
                        const entries = fs.readdirSync(tmpExtractDir);
                        if (entries.length === 1) {
                            const innerDir = path.join(tmpExtractDir, entries[0]);
                            fs.cpSync(innerDir, SCRIPT_DIR, { recursive: true });
                        } else {
                            fs.cpSync(tmpExtractDir, SCRIPT_DIR, { recursive: true });
                        }
                        fs.rmSync(tmpExtractDir, { recursive: true, force: true });
                    }
                }
            }

            if (!downloadUrl) {
                // Fallback to git clone
                const tmpCloneDir = path.join(SCRIPT_DIR, 'openclaw-tmp-clone');
                const runClone = runCommand(`git clone https://github.com/openclaw/openclaw.git "${tmpCloneDir}"`, SCRIPT_DIR);
                if (runClone.status !== 0) {
                    console.error("[!] " + L.cloneFail);
                    try { fs.rmSync(tmpCloneDir, { recursive: true, force: true }); } catch(_) {}
                    process.exit(1);
                }
                fs.cpSync(tmpCloneDir, SCRIPT_DIR, { recursive: true });
                fs.rmSync(tmpCloneDir, { recursive: true, force: true });
            }

            isOpenclawPresent = true;
            console.log(L.cloneSuccess + "\n");
    }

    // build target validation (dist/index.js shouldn't be missing if properly built)
    if (!fs.existsSync(path.join(OPENCLAW_ROOT, "dist", "index.js"))) {
        openclawNeedsBuild = true;
    }

    if (openclawNeedsBuild) {
        console.log(L.buildingOpenclaw);
        const res = buildOpenclaw(OPENCLAW_ROOT);
        if (res.status !== 0) {
            console.error("Error: OpenClaw build failed. Setup cannot continue.");
            process.exit(1);
        }
        console.log(L.buildOpenclawSuccess + "\n");
    } else {
        console.log(L.buildOpenclawSuccess + " (Skipped / 読込済)\n");
    }

    // 2. Install Gemini Backend dependencies
    console.log("[2/4] " + L.checkGeminiDep);
    const depRes = runCommand("npm install", PLUGIN_DIR);
    if (depRes.status !== 0) {
        console.error("[!] " + L.npmFail);
        process.exit(1);
    }
    console.log(L.installDepSuccess + "\n");

    // 2.5 Sync Gemini Models to OpenClaw
    console.log("[~] " + L.syncModels);
    const syncRes = runCommand("node scripts/update_models.mjs", PLUGIN_DIR);
    if (syncRes.status !== 0) {
        console.error("(!) " + L.syncFail);
    } else {
        console.log(L.syncSuccess + "\n");
    }

    // 3. Register adapter in openclaw.json
    console.log("[3/4] " + L.registerAdapter);
    
    let config = {};
    if (fs.existsSync(OPENCLAW_CONFIG)) {
        try {
            config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, "utf-8"));
        } catch (e) {
            console.warn("Warning: Failed to parse openclaw.json, creating a new structure.");
        }
    } else {
        fs.mkdirSync(path.dirname(OPENCLAW_CONFIG), { recursive: true });
    }

    if (!config.models) config.models = {};
    config.models.primary = "gemini-adapter/auto-gemini-3";

    try {
        fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), "utf-8");
        console.log(L.registerAdapterSuccess + "\n");
    } catch (e) {
        console.error("Error writing openclaw.json:", e);
    }

    // 4. Gemini CLI Authentication
    console.log("[4/4] " + L.checkAuth);
    const credsPath1 = path.join(GEMINI_CREDS_DIR, "oauth_creds.json");
    const credsPath2 = path.join(GEMINI_CREDS_DIR, "google_accounts.json");
    
    if (!fs.existsSync(credsPath1) && !fs.existsSync(credsPath2)) {
        console.log(L.authStart);
        
        // Prefer the locally installed gemini CLI in openclaw-gemini-cli-adapter, fallback to npx
        const localGeminiPath = path.join(PLUGIN_DIR, "node_modules", ".bin", "gemini");
        const commandToRun = fs.existsSync(localGeminiPath) ? localGeminiPath : "npx gemini";
        
        // IMPORTANT: Close readline BEFORE running gemini login.
        // If rl is open, it holds stdin and the gemini login subprocess
        // cannot receive the auth code pasted by the user.
        rl.close();

        // Open browser automatically if possible.
        // We've already closed readline above, so the terminal is ready for the auth code.
        await new Promise((resolve) => {
            const { spawn } = require('child_process');
            const cmdParts = commandToRun.split(' ');
            
            console.log("\n[Gemini TUI Start] Please follow the authentication flow (browser may open).");
            console.log("When authentication is successful, this installer will detect it and proceed automatically!");
            console.log("-----------------------------------------");
            
            const child = spawn(cmdParts[0], cmdParts.slice(1).concat(['login']), {
                cwd: PLUGIN_DIR,
                env: { ...process.env, GEMINI_CLI_HOME: GEMINI_CREDS_DIR },
                stdio: 'inherit'
            });

            // Poll for the credentials file. If it exists, login succeeded.
            const checkInterval = setInterval(() => {
                if (fs.existsSync(credsPath1) || fs.existsSync(credsPath2)) {
                    clearInterval(checkInterval);
                    console.log("\n-----------------------------------------");
                    console.log("Auth credentials detected. Auto-exiting Gemini CLI...");
                    setTimeout(() => {
                        child.kill('SIGINT');
                        setTimeout(() => {
                            try { child.kill('SIGKILL'); } catch (e) {}
                        }, 1000);
                        resolve();
                    }, 500); // Give CLI a moment to write everything safely
                }
            }, 1000);

            child.on('close', () => {
                clearInterval(checkInterval);
                resolve();
            });
        });        
        if (fs.existsSync(credsPath1) || fs.existsSync(credsPath2)) {
            console.log(L.authSuccess + "\n");
        } else {
            console.log(L.authMissingTip + "\n");
        }
    } else {
        console.log(L.authSuccess + " (Skipped / 読込済)\n");
    }

    console.log("=================================================");
    console.log(L.finish);
    
    // Write out how to use it
    console.log("");
    console.log(L.configTip);
    console.log('  "models": {');
    console.log('    "primary": "gemini-adapter/auto-gemini-3"');
    console.log('  }');
    console.log("");
    console.log(L.tryIt);
    console.log("");
    console.log(L.versionNote);
    console.log("=================================================");

    rl.close();
}

main().catch((err) => {
    console.error("Fatal error during setup:", err);
    rl.close();
    process.exit(1);
});
