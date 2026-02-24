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
const ADAPTER_JS = path.join(SCRIPT_DIR, "adapter.js");
const OPENCLAW_CONFIG = path.join(os.homedir(), ".openclaw", "openclaw.json");
const GEMINI_CREDS_DIR = path.join(os.homedir(), ".gemini");

// Messages vocabulary
const MSG = {
    ja: {
        welcome: "OpenClaw Gemini Backend セットアップへようこそ！",
        checkOpenclaw: "OpenClaw 本体のインストール状態をチェックしています...",
        installOpenclaw: "OpenClaw がビルドされていないようです。ビルドを実行しますか？ (Y/n): ",
        buildingOpenclaw: "OpenClaw をビルド中 (npm install && npm run build)...",
        buildOpenclawSuccess: "✓ OpenClaw のビルド完了",
        checkGeminiDep: "Gemini Backend (このフォルダ) の npm パッケージをインストール中...",
        installDepSuccess: "✓ npm 依存関係のインストール完了",
        registerAdapter: "openclaw.json に gemini-adapter を登録しています...",
        registerAdapterSuccess: "✓ gemini-adapter の登録完了",
        checkAuth: "Gemini CLI の認証状況をチェックしています...",
        authNeeded: "Gemini API の認証が見つかりません。今すぐログインしますか？ (Y/n): ",
        authStart: "認証を開始します。ターミナルに表示される指示に従ってログインしてください...",
        authSuccess: "✓ Gemini 認証完了",
        finish: "セットアップがすべて完了しました！",
        tryIt: "試してみる: node ../scripts/run-node.mjs agent -m 'こんにちは' --local"
    },
    en: {
        welcome: "Welcome to OpenClaw Gemini Backend Setup!",
        checkOpenclaw: "Checking OpenClaw base installation...",
        installOpenclaw: "OpenClaw does not appear to be built. Build it now? (Y/n): ",
        buildingOpenclaw: "Building OpenClaw (npm install && npm run build)...",
        buildOpenclawSuccess: "✓ OpenClaw build complete",
        checkGeminiDep: "Installing npm dependencies for Gemini Backend...",
        installDepSuccess: "✓ npm dependencies installed",
        registerAdapter: "Registering gemini-adapter in openclaw.json...",
        registerAdapterSuccess: "✓ gemini-adapter registered",
        checkAuth: "Checking Gemini CLI authentication...",
        authNeeded: "Gemini API authentication not found. Login now? (Y/n): ",
        authStart: "Starting authentication. Please follow the instructions to login...",
        authSuccess: "✓ Gemini authentication complete",
        finish: "Setup is fully complete!",
        tryIt: "Try it out: node ../scripts/run-node.mjs agent -m 'hello' --local"
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

async function main() {
    console.log("=================================================");
    
    // 0. Language selection
    const lang = await question("Select language / 言語を選択してください [1] English [2] 日本語 (1/2): ");
    if (lang.trim() === '2') {
        L = MSG.ja;
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
        console.log("OpenClaw repository not found in parent directory.");
        const dlAns = await question("OpenClaw本体が見つかりません。自動的にダウンロード (git clone) しますか？ / Download OpenClaw now? (Y/n): ");
        if (dlAns.trim() === '' || dlAns.trim().toLowerCase() === 'y') {
            console.log("Cloning OpenClaw...");
            // Clone into parent directory's 'openclaw' folder if parent is not openclaw itself
            const runClone = runCommand("git clone https://github.com/openclaw/openclaw.git openclaw-core", SCRIPT_DIR);
            if (runClone.status !== 0) {
                console.error("Error: Failed to download OpenClaw.");
                process.exit(1);
            }
            // Update OPENCLAW_ROOT to the newly cloned directory
            OPENCLAW_ROOT = path.resolve(SCRIPT_DIR, "openclaw-core");
            isOpenclawPresent = true;
            console.log("✓ OpenClaw downloaded.\n");
        } else {
            console.error("\n[!] " + (lang.trim() === '2' ? "セットアップを中断しました。" : "Setup aborted."));
            console.error(lang.trim() === '2' ? "すでに OpenClaw がインストールされている場合は、この 'gemini-cli-claw' フォルダを OpenClaw のルートディレクトリ直下に配置してから再度 setup.js または install.sh を実行してください。" : "If OpenClaw is already installed, please move this 'gemini-cli-claw' folder directly into your OpenClaw root directory and run setup.js again.");
            console.error(lang.trim() === '2' ? "配置例:" : "Example:");
            console.error("  openclaw/");
            console.error("  ├── src/");
            console.error("  ├── package.json");
            console.error("  └── gemini-cli-claw/   <-- ここに配置 / Place it here");
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
            const res = runCommand("npm install && npm run build", OPENCLAW_ROOT);
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
        console.error("Error: npm install failed for gemini-cli-claw.");
        process.exit(1);
    }
    console.log(L.installDepSuccess + "\n");

    // 2.5 Sync Gemini Models to OpenClaw
    console.log("[~] Syncing Gemini models to OpenClaw...");
    const syncRes = runCommand("node scripts/update_models.js", SCRIPT_DIR);
    if (syncRes.status !== 0) {
        console.error("Warning: Failed to sync Gemini models. Models might not appear in OpenClaw UI.");
    }
    console.log("✓ Models synced\n");

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
    if (!config.agents.defaults.cliBackends) config.agents.defaults.cliBackends = {};

    // Dynamic path handling: Portable, robust absolute path calculation
    config.agents.defaults.cliBackends["gemini-adapter"] = {
        command: "node",
        input: "stdin",
        output: "text", // essential: ensures OpenClaw parses text out correctly
        systemPromptArg: "--system",
        args: [
            ADAPTER_JS,
            "--session-id", "{sessionId}",
            "--allowed-skills", "{allowedSkillsPaths}"
        ],
        resumeArgs: [
            ADAPTER_JS,
            "--session-id", "{sessionId}",
            "--allowed-skills", "{allowedSkillsPaths}"
        ]
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
                console.log("Info: Authentication credentials still not found. You may need to manually run `npx @google/gemini-cli login` later.\n");
            }
        }
    } else {
        console.log(L.authSuccess + " (Already authenticated / 認証済)\n");
    }

    console.log("=================================================");
    console.log(L.finish);
    
    // Write out how to use it
    console.log("");
    console.log("If you haven't already, add this to ~/.openclaw/openclaw.json:");
    console.log('  "agents": {');
    console.log('    "defaults": {');
    console.log('      "provider": "gemini-adapter"');
    console.log('    }');
    console.log('  }');
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
