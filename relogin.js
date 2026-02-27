#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const PLUGIN_DIR = SCRIPT_DIR;
const GEMINI_CREDS_DIR = path.join(PLUGIN_DIR, "gemini-home");

console.log("\n==============================================================");
console.log(" Gemini CLI 再ログインユーティリティ");
console.log("==============================================================\n");
console.log("認証セッションをリフレッシュします。");
console.log("ブラウザが開いたら、Googleアカウントでログインしてください。\n");

const credsPaths = [
    path.join(GEMINI_CREDS_DIR, ".gemini", "oauth_creds.json"),
    path.join(GEMINI_CREDS_DIR, ".gemini", "google_accounts.json"),
    path.join(GEMINI_CREDS_DIR, "oauth_creds.json"),
    path.join(GEMINI_CREDS_DIR, "google_accounts.json")
];

function hasValidCredentials() {
    for (const p of credsPaths) {
        if (!fs.existsSync(p)) continue;
        try {
            const raw = fs.readFileSync(p, 'utf-8').trim();
            if (!raw || raw.length < 10) continue;
            const data = JSON.parse(raw);
            // oauth_creds.json用
            if (data.refresh_token || data.access_token) return true;
            // google_accounts.json用
            if (data.active !== undefined && data.active !== null) return true;
        } catch (e) {
            // パース失敗時はまだ不完全なJSONなのでスキップ
        }
    }
    return false;
}

// 既存の古いセッションが存在する場合のみクリア（認証の書き込み完了を正確に検知するため）
let removedOld = false;
for (const p of credsPaths) {
    if (fs.existsSync(p)) {
        try {
            fs.unlinkSync(p);
            removedOld = true;
        } catch (e) {
            console.warn(`古い認証ファイルの削除に失敗しました: ${p}`);
        }
    }
}
if (removedOld) {
    console.log("既存の古いセッションをクリアしました。");
}

const localGeminiPath = path.join(PLUGIN_DIR, "node_modules", ".bin", "gemini");
const commandToRun = fs.existsSync(localGeminiPath) ? localGeminiPath : "npx gemini";
const cmdParts = commandToRun.split(' ');

console.log("-----------------------------------------");
console.log("※ 意味がわからない時は、とりあえず「エンターキー」だけ押してください！");
console.log("※ ブラウザが自動で開いたら、使いたいGoogleアカウントでログインするだけでOKです。");
console.log("-----------------------------------------\n");

// 環境変数 GEMINI_CLI_HOME を分離して実行 (既存のグローバル設定を汚染しない)
const child = spawn(cmdParts[0], cmdParts.slice(1).concat(['login']), {
    cwd: PLUGIN_DIR,
    env: { ...process.env, GEMINI_CLI_HOME: GEMINI_CREDS_DIR },
    stdio: 'inherit'
});

let killed = false;
let checkCount = 0;

const checkInterval = setInterval(() => {
    checkCount++;
    if (checkCount < 2) return; // 最初の数秒はブラウザを開く動作を待つ

    if (hasValidCredentials()) {
        clearInterval(checkInterval);
        if (!killed) {
            killed = true;
            console.log("\n-----------------------------------------");
            console.log("✓ 認証が確認できました！(Gemini CLI を自動終了します...)");
            // 少しだけ書き込み猶予を与える
            setTimeout(() => {
                try { child.kill('SIGKILL'); } catch (e) {}
                console.log("\n==============================================================");
                console.log(" ログイン処理が完了しました。");
                console.log("==============================================================");
                console.log("引き続きOpenClawからGeminiアダプタをご利用いただけます。\n");
                process.exit(0);
            }, 1000);
        }
    }
}, 2000);

child.on('close', () => {
    clearInterval(checkInterval);
    if (!killed) {
        process.exit(0);
    }
});
