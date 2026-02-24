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
let OPENCLAW_ROOT = path.resolve(SCRIPT_DIR, "..");
const SERVER_JS = path.join(SCRIPT_DIR, "src", "server.js");
const OPENCLAW_CONFIG = path.join(os.homedir(), ".openclaw", "openclaw.json");
const GEMINI_CREDS_DIR = path.join(os.homedir(), ".gemini");

// Messages vocabulary
const MSG = {
    ja: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "OpenClaw Gemini Backend セットアップへようこそ！",
        checkOpenclaw: "OpenClaw 本体のインストール状態をチェックしています...",
        notFoundOpenclaw: "OpenClaw 本体が見つかりません。",
        suggestClone: "自動的にダウンロード (git clone) しますか？ (Y/n): ",
        cloning: "OpenClaw をクローン中...",
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
        configTip: "まだ設定していない場合は、~/.openclaw/openclaw.json に以下を追加してください:",
        finish: "セットアップがすべて完了しました！",
        tryIt: "試してみる: node ../scripts/run-node.mjs agent -m 'こんにちは' --local"
    },
    en: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "Welcome to OpenClaw Gemini Backend Setup!",
        checkOpenclaw: "Checking OpenClaw base installation...",
        notFoundOpenclaw: "OpenClaw repository not found in parent directory.",
        suggestClone: "Download OpenClaw automatically? (Y/n): ",
        cloning: "Cloning OpenClaw...",
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
        configTip: "If you haven't already, add this to ~/.openclaw/openclaw.json:",
        finish: "Setup is fully complete!",
        tryIt: "Try it out: node ../scripts/run-node.mjs agent -m 'hello' --local"
    },
    zh: {
        selectLang: "Select language / 言語選択 / 选择语言 [1] English [2] 日本語 [3] 简体中文 (1/2/3): ",
        welcome: "欢迎使用 OpenClaw Gemini 后端安装程序！",
        checkOpenclaw: "正在检查 OpenClaw 本体的安装状态...",
        notFoundOpenclaw: "未发现 OpenClaw 本体。",
        suggestClone: "是否自动下载 (git clone)？ (Y/n): ",
        cloning: "正在克隆 OpenClaw...",
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
        configTip: "如果尚未配置，请将以下内容添加到 ~/.openclaw/openclaw.json：",
        finish: "安装全部完成！",
        tryIt: "尝试运行：node ../scripts/run-node.mjs agent -m '你好' --local"
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
    // 0. Language selection (Detection & Choice)
    const envLang = (process.env.LANG || "").toLowerCase();
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

    console.log("\n" + L.welcome);
    console.log("=================================================\n");

    // 1. Check & Download OpenClaw
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
        const dlAns = await question(L.suggestClone);
        if (dlAns.trim() === '' || dlAns.trim().toLowerCase() === 'y') {
            console.log(L.cloning);
            // Clone into parent directory's 'openclaw' folder if parent is not openclaw itself
            const runClone = runCommand("git clone https://github.com/openclaw/openclaw.git openclaw-core", SCRIPT_DIR);
            if (runClone.status !== 0) {
                console.error("[!] " + L.cloneFail);
                process.exit(1);
            }
            // Update OPENCLAW_ROOT to the newly cloned directory
            OPENCLAW_ROOT = path.resolve(SCRIPT_DIR, "openclaw-core");
            isOpenclawPresent = true;
            console.log(L.cloneSuccess + "\n");
        } else {
            const folderName = path.basename(SCRIPT_DIR);
            console.error("\n[!] " + L.setupAborted);
            console.error(L.relocationTip.replace("{RENAME_ME}", folderName));
            console.error(L.placementEx);
            console.error("  openclaw/");
            console.error("  ├── src/");
            console.error("  ├── package.json");
            console.error(`  └── ${folderName}/   <-- ${L.ja ? "ここ" : (L.zh ? "这里" : "here")}`);
            console.error("      └── setup.js\n");
            process.exit(1);
        }
    }

    // build target validation (dist/index.js shouldn't be missing if properly built)
    if (!fs.existsSync(path.join(OPENCLAW_ROOT, "dist", "index.js"))) {
        openclawNeedsBuild = true;
    }

    if (openclawNeedsBuild) {
        const buildAns = await question(L.installOpenclaw);
        if (buildAns.trim() === '' || buildAns.trim().toLowerCase() === 'y') {
            console.log(L.buildingOpenclaw);
            const res = buildOpenclaw(OPENCLAW_ROOT);
            if (res.status !== 0) {
                console.error("Error: OpenClaw build failed. Setup cannot continue.");
                process.exit(1);
            }
            console.log(L.buildOpenclawSuccess + "\n");
        }
    } else {
        console.log(L.buildOpenclawSuccess + " (Skipped / 読込済)\n");
    }

    // 2. Install Gemini Backend dependencies
    console.log("[2/4] " + L.checkGeminiDep);
    const depRes = runCommand("npm install", SCRIPT_DIR);
    if (depRes.status !== 0) {
        console.error("[!] " + L.npmFail);
        process.exit(1);
    }
    console.log(L.installDepSuccess + "\n");

    // 2.5 Sync Gemini Models to OpenClaw
    console.log("[~] " + L.syncModels);
    const syncRes = runCommand("node scripts/update_models.js", SCRIPT_DIR);
    if (syncRes.status !== 0) {
        console.error("(!) " + L.syncFail);
    }
    console.log(L.syncSuccess + "\n");

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

    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.providers) config.providers = {};

    // Register as an OpenAI-compatible provider
    config.agents.defaults.provider = "gemini-adapter";
    config.providers["gemini-adapter"] = {
        type: "openai",
        baseUrl: "http://localhost:3972",
        apiKey: "none",
        model: "auto-gemini-3"
    };

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
        const authAns = await question(L.authNeeded);
        if (authAns.trim() === '' || authAns.trim().toLowerCase() === 'y') {
            console.log(L.authStart);
            
            // Prefer the locally installed gemini CLI in gemini-cli-claw, fallback to npx
            const localGeminiPath = path.join(SCRIPT_DIR, "node_modules", ".bin", "gemini");
            const commandToRun = fs.existsSync(localGeminiPath) ? localGeminiPath : "npx gemini";
            
            // Use --no-browser to avoid terminal hanging issues in headless/SSH setups
            runCommand(commandToRun + " login --no-browser", SCRIPT_DIR);
            
            if (fs.existsSync(credsPath1) || fs.existsSync(credsPath2)) {
                console.log(L.authSuccess + "\n");
            } else {
                console.log(L.authMissingTip + "\n");
            }
        }
    } else {
        console.log(L.authSuccess + " (Skipped / 読込済)\n");
    }

    console.log("=================================================");
    console.log(L.finish);
    
    // Write out how to use it
    console.log("");
    console.log(L.configTip);
    console.log('  "agents": { "defaults": { "provider": "gemini-adapter" } },');
    console.log('  "providers": { "gemini-adapter": { "type": "openai", "baseUrl": "http://localhost:3972", ... } }');
    console.log("");
    console.log(L.tryIt);
    console.log("=================================================");

    rl.close();
}

main().catch((err) => {
    console.error("Fatal error during setup:", err);
    rl.close();
    process.exit(1);
});
