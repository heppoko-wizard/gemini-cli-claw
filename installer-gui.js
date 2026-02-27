#!/usr/bin/env node
/**
 * installer-gui.js — OpenClaw Gemini CLI Adapter - GUI Installer Server
 *
 * setup.js と完全に同一のロジックをブラウザ経由で提供するローカルWebサーバー。
 * Node.js 標準モジュールのみ使用（追加の npm install 不要）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');

// ============================================================
// パス解決 (setup.js と同一ロジック)
// ============================================================
const SCRIPT_DIR = __dirname;
const BASENAME = path.basename(SCRIPT_DIR);

let OPENCLAW_ROOT, PLUGIN_DIR;
if (BASENAME === 'openclaw-gemini-cli-adapter' || BASENAME === 'gemini-cli-claw') {
    // 開発環境またはアダプタフォルダ内から実行
    OPENCLAW_ROOT = path.resolve(SCRIPT_DIR, '..');
    PLUGIN_DIR = SCRIPT_DIR;
} else {
    // リリースパッケージのルートから実行
    OPENCLAW_ROOT = SCRIPT_DIR;
    PLUGIN_DIR = path.join(SCRIPT_DIR, 'openclaw-gemini-cli-adapter');
}

const PUBLIC_DIR = path.join(PLUGIN_DIR, 'public');
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const GEMINI_CREDS_DIR = path.join(PLUGIN_DIR, 'src', '.gemini');
const PORT = 19872;

// ============================================================
// 認証チェック (setup.js と同一ロジック)
// ============================================================
const credsPaths = [
    path.join(GEMINI_CREDS_DIR, '.gemini', 'oauth_creds.json'),
    path.join(GEMINI_CREDS_DIR, '.gemini', 'google_accounts.json'),
    path.join(GEMINI_CREDS_DIR, 'oauth_creds.json'),
    path.join(GEMINI_CREDS_DIR, 'google_accounts.json'),
];

function hasValidCredentials() {
    for (const p of credsPaths) {
        if (!fs.existsSync(p)) continue;
        try {
            const raw = fs.readFileSync(p, 'utf-8').trim();
            if (!raw || raw.length < 10) continue;
            const data = JSON.parse(raw);
            if (data.refresh_token || data.access_token) return true;
            if (data.active !== undefined && data.active !== null) return true;
        } catch (e) {}
    }
    return false;
}

// ============================================================
// OpenClaw 存在確認
// ============================================================
function isOpenClawPresent() {
    const pkgPath = path.join(OPENCLAW_ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.name === 'openclaw';
    } catch (e) {
        return false;
    }
}

function isOpenClawBuilt() {
    return fs.existsSync(path.join(OPENCLAW_ROOT, 'dist', 'index.js'));
}

// ============================================================
// SSE ログ管理
// ============================================================
let logClients = [];

function broadcastLog(message, type = 'log') {
    const data = `data: ${JSON.stringify({ type, message })}\n\n`;
    logClients.forEach(c => {
        try { c.write(data); } catch(e) {}
    });
    console.log(`[GUI] ${message}`);
}

// ============================================================
// コマンド実行ヘルパー (spawn + SSE ログ)
// ============================================================
function runCmd(cmd, cwd, label) {
    return new Promise((resolve) => {
        broadcastLog(`▶ ${label}`, 'step_start');
        const child = spawn(cmd, { shell: true, cwd });
        child.stdout.on('data', d => broadcastLog(d.toString().trim(), 'stdout'));
        child.stderr.on('data', d => broadcastLog(d.toString().trim(), 'stderr'));
        child.on('close', code => {
            if (code === 0) {
                broadcastLog(`✓ ${label}`, 'step_done');
                resolve(true);
            } else {
                broadcastLog(`✗ ${label} (exit ${code})`, 'step_error');
                resolve(false);
            }
        });
        child.on('error', err => {
            broadcastLog(`✗ ${label}: ${err.message}`, 'step_error');
            resolve(false);
        });
    });
}

// ============================================================
// OpenClaw ダウンロード (setup.js と同一ロジック)
// ============================================================
async function downloadOpenClaw() {
    broadcastLog('OpenClaw 本体が見つかりません。最新リリースを取得します...', 'step_start');

    let downloadUrl = null;
    let releaseTag = null;

    // 1. GitHub API で最新リリース URL 取得
    try {
        const releaseInfo = await new Promise((resolve, reject) => {
            https.get({
                hostname: 'api.github.com',
                path: '/repos/openclaw/openclaw/releases/latest',
                headers: { 'User-Agent': 'openclaw-gemini-cli-adapter-setup' }
            }, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { reject(new Error('Invalid JSON from GitHub API')); }
                });
            }).on('error', reject);
        });

        releaseTag = releaseInfo.tag_name;
        if (releaseInfo.zipball_url) {
            downloadUrl = releaseInfo.zipball_url;
            broadcastLog(`最新リリース: ${releaseTag}`, 'log');
        }
    } catch (e) {
        broadcastLog(`GitHub API エラー: ${e.message}。git clone を試みます...`, 'warning');
    }

    if (downloadUrl) {
        // 2. curl でZIPダウンロード
        const zipPath = path.join(SCRIPT_DIR, 'openclaw-release.zip');
        const dlOk = await runCmd(
            `curl -L -o "${zipPath}" "${downloadUrl}"`,
            SCRIPT_DIR,
            'OpenClaw ZIP ダウンロード'
        );

        if (dlOk) {
            // 3. unzip して OPENCLAW_ROOT に展開
            const tmpDir = path.join(SCRIPT_DIR, 'openclaw-tmp-extract');
            fs.mkdirSync(tmpDir, { recursive: true });
            const unzipOk = await runCmd(
                `unzip -q "${zipPath}" -d "${tmpDir}"`,
                SCRIPT_DIR,
                'ZIP 展開'
            );
            try { fs.rmSync(zipPath); } catch (_) {}

            if (unzipOk) {
                try {
                    const entries = fs.readdirSync(tmpDir);
                    const innerDir = entries.length === 1
                        ? path.join(tmpDir, entries[0])
                        : tmpDir;
                    fs.cpSync(innerDir, OPENCLAW_ROOT, { recursive: true });
                    fs.rmSync(tmpDir, { recursive: true, force: true });
                    broadcastLog('✓ OpenClaw のファイルを展開しました', 'step_done');
                    return true;
                } catch (e) {
                    broadcastLog(`展開コピーエラー: ${e.message}`, 'step_error');
                    downloadUrl = null;
                }
            } else {
                downloadUrl = null;
            }
        } else {
            downloadUrl = null;
        }
    }

    if (!downloadUrl) {
        // 4. Fallback: git clone (--depth 1 で認証不要の公開リポジトリなら通る)
        const tmpClone = path.join(SCRIPT_DIR, 'openclaw-tmp-clone');
        const cloneOk = await runCmd(
            `git clone --depth 1 https://github.com/openclaw/openclaw.git "${tmpClone}"`,
            SCRIPT_DIR,
            'OpenClaw git clone'
        );

        if (!cloneOk) {
            broadcastLog('OpenClaw のダウンロードに失敗しました。', 'step_error');
            return false;
        }

        try {
            fs.cpSync(tmpClone, OPENCLAW_ROOT, { recursive: true });
            fs.rmSync(tmpClone, { recursive: true, force: true });
            broadcastLog('✓ OpenClaw (git clone) の展開完了', 'step_done');
        } catch (e) {
            broadcastLog(`コピーエラー: ${e.message}`, 'step_error');
            return false;
        }
    }

    return true;
}

// ============================================================
// メインセットアップ処理
// ============================================================
async function runSetup(setPrimary) {
    let success = true;

    // [1/4] OpenClaw 確認・ダウンロード
    broadcastLog('[1/4] OpenClaw の状態を確認しています...', 'step_start');
    if (!isOpenClawPresent()) {
        const dlOk = await downloadOpenClaw();
        if (!dlOk) { success = false; }

        if (success) {
            // npm install
            const rootInstallOk = await runCmd('npm install', OPENCLAW_ROOT, 'OpenClaw npm install');
            if (!rootInstallOk) success = false;
        }

        if (success && !isOpenClawBuilt()) {
            // pnpm が必要 → なければ install
            const pnpmCheck = await runCmd('pnpm --version', OPENCLAW_ROOT, 'pnpm バージョン確認');
            if (!pnpmCheck) {
                await runCmd('npm install -g pnpm', OPENCLAW_ROOT, 'pnpm インストール');
            }
            const buildOk = await runCmd('npm run build', OPENCLAW_ROOT, 'OpenClaw ビルド');
            if (!buildOk) success = false;
        }
    } else {
        broadcastLog('✓ OpenClaw 本体を確認しました', 'step_done');

        if (!isOpenClawBuilt()) {
            broadcastLog('OpenClaw がビルドされていません。ビルドを実行します...', 'log');
            const pnpmCheck = await runCmd('pnpm --version', OPENCLAW_ROOT, 'pnpm バージョン確認');
            if (!pnpmCheck) {
                await runCmd('npm install -g pnpm', OPENCLAW_ROOT, 'pnpm インストール');
            }
            const buildOk = await runCmd('npm run build', OPENCLAW_ROOT, 'OpenClaw ビルド');
            if (!buildOk) success = false;
        } else {
            broadcastLog('✓ OpenClaw ビルド済み (スキップ)', 'step_done');
        }
    }

    if (!success) {
        broadcastLog('セットアップ失敗: OpenClaw のセットアップ中にエラーが発生しました。', 'done');
        return;
    }

    // [2/4] アダプタ npm install（Gemini CLI を含む）
    broadcastLog('[2/4] アダプタの依存関係をインストールしています...（@google/gemini-cli を含む）', 'step_start');
    if (!fs.existsSync(path.join(PLUGIN_DIR, 'node_modules'))) {
        broadcastLog('Gemini CLI (@google/gemini-cli) を含む全依存関係をインストールします...', 'log');
        const depOk = await runCmd('npm install', PLUGIN_DIR, 'アダプタ npm install（Gemini CLI DL含む）');
        if (!depOk) success = false;
    } else {
        broadcastLog('✓ 依存関係はインストール済みです (スキップ)', 'step_done');
    }

    // [2.5] モデル同期
    if (success) {
        broadcastLog('[2.5] Gemini モデルを OpenClaw に同期しています...', 'step_start');
        const syncOk = await runCmd('node scripts/update_models.mjs', PLUGIN_DIR, 'モデル同期');
        if (!syncOk) broadcastLog('警告: モデル同期に失敗しましたが、続行します。', 'warning');
    }

    // [3/4] openclaw.json 登録
    if (success) {
        broadcastLog('[3/4] openclaw.json にアダプタを登録しています...', 'step_start');
        try {
            let config = {};
            if (fs.existsSync(OPENCLAW_CONFIG)) {
                try { config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8')); }
                catch (e) { /* ignore */ }
            } else {
                fs.mkdirSync(path.dirname(OPENCLAW_CONFIG), { recursive: true });
            }

            if (!config.models) config.models = {};
            if (setPrimary) {
                config.models.primary = 'gemini-adapter/auto-gemini-3';
                broadcastLog('✓ Gemini アダプタをプライマリモデルに設定しました', 'step_done');
            } else {
                broadcastLog('✓ openclaw.json を更新しました (primary 設定はスキップ)', 'step_done');
            }

            fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
        } catch (e) {
            broadcastLog(`openclaw.json 書き込みエラー: ${e.message}`, 'step_error');
            success = false;
        }
    }

    broadcastLog(
        success ? '[4/4] セットアップ完了！次は「認証」ステップに進んでください。' : 'セットアップ中にエラーが発生しました。',
        'done'
    );
}

// ============================================================
// HTTP サーバー
// ============================================================
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
};

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    const sendJson = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    const parseBody = () => new Promise(resolve => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
    });

    // --- Static files ---
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'installer.html' : url.pathname);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
        if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not Found'); }
        const ct = MIME[path.extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        return fs.createReadStream(filePath).pipe(res);
    }

    // --- API: Status ---
    if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(200, {
            isOpenClawPresent: isOpenClawPresent(),
            isBuilt: isOpenClawBuilt(),
            hasAuth: hasValidCredentials(),
            pluginDir: PLUGIN_DIR,
            openclawRoot: OPENCLAW_ROOT,
        });
    }

    // --- API: Log SSE ---
    if (req.method === 'GET' && url.pathname === '/api/logs') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        logClients.push(res);
        req.on('close', () => { logClients = logClients.filter(c => c !== res); });
        return;
    }

    // --- API: Setup ---
    if (req.method === 'POST' && url.pathname === '/api/setup') {
        parseBody().then(body => {
            sendJson(200, { started: true });
            runSetup(body.setPrimary || false);
        });
        return;
    }

    // --- API: Auth Start ---
    if (req.method === 'POST' && url.pathname === '/api/auth/start') {
        const localGemini = path.join(PLUGIN_DIR, 'node_modules', '.bin', 'gemini');
        const geminiCmd = fs.existsSync(localGemini) ? localGemini : 'gemini';

        broadcastLog('Gemini CLI の認証プロセスを準備中...', 'step_start');

        // [1] settings.json に oauth-personal を事前設定（認証タイプ選択UIを自動スキップ）
        const settingsDir = path.join(GEMINI_CREDS_DIR, '.gemini');
        const settingsPath = path.join(settingsDir, 'settings.json');
        fs.mkdirSync(settingsDir, { recursive: true });

        let geminiSettings = {};
        try { geminiSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch (_) {}
        if (!geminiSettings.security?.auth?.selectedType) {
            geminiSettings.security = geminiSettings.security || {};
            geminiSettings.security.auth = geminiSettings.security.auth || {};
            geminiSettings.security.auth.selectedType = 'oauth-personal';
            fs.writeFileSync(settingsPath, JSON.stringify(geminiSettings, null, 2));
            broadcastLog('✓ 認証タイプを oauth-personal に事前設定しました', 'log');
        }

        broadcastLog('ブラウザを自動で開いて認証ページへ誘導します...', 'log');

        // [2] script コマンドで pseudo-TTY を作成して gemini login を実行
        // (isTTY=false だと Gemini CLI がヘッドレス判定して FatalAuthenticationError を throw するため)
        const envStr = `GEMINI_CLI_HOME='${GEMINI_CREDS_DIR}'`;
        const scriptCmd = `script -q -f /dev/null -c '${envStr} "${geminiCmd}" login'`;

        const child = spawn('bash', ['-c', scriptCmd], {
            cwd: PLUGIN_DIR,
            env: { ...process.env, GEMINI_CLI_HOME: GEMINI_CREDS_DIR, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // [3] stdout 監視で consent 質問に自動 y 応答
        let answeredConsent = false;
        const onData = (d) => {
            const text = d.toString();
            // ANSIエスケープコードを除去してブラウザへ配信
            const clean = text.replace(/\x1B\[[0-9;]*[mGKHFJA-Z]/g, '').replace(/\r/g, '').trim();
            if (clean) broadcastLog(clean, 'log');

            // 同意プロンプト自動応答
            if (!answeredConsent && (text.includes('Do you want to continue') || text.includes('[Y/n]') || text.includes('続けますか'))) {
                answeredConsent = true;
                broadcastLog('→ 同意確認を検出。自動で "y" を送信します', 'log');
                setTimeout(() => { try { child.stdin.write('y\n'); } catch (_) {} }, 200);
            }
        };

        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        child.on('close', (code) => {
            console.log(`[Auth] gemini login exited with code ${code}`);
            if (!hasValidCredentials()) {
                broadcastLog(`gemini login が終了しました (exit code: ${code})`, code === 0 ? 'log' : 'warning');
            }
        });

        child.on('error', (err) => {
            console.error('[Auth] spawn error:', err.message);
            broadcastLog(`認証プロセスの起動に失敗: ${err.message}`, 'step_error');
        });

        // [4] 認証完了ポーリング → SSE で完了通知と新しいタブを開く
        let killed = false;
        const poll = setInterval(() => {
            if (hasValidCredentials() && !killed) {
                killed = true;
                clearInterval(poll);
                broadcastLog('✓ 認証が完了しました！新しいタブで完了画面を開きます...', 'step_done');

                // 認証完了時に、ユーザーが元のタブを探す手間を省くため強制的に新しいタブを開く
                const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
                const port = req.socket.localPort || req.socket.server.address().port;
                spawn(startCmd, [`http://127.0.0.1:${port}`], { detached: true, stdio: 'ignore' }).unref();

                setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 1500);
            }
        }, 2000);

        child.on('close', () => clearInterval(poll));

        return sendJson(200, { message: 'Auth process started' });
    }

    // --- API: Auth Status ---
    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        return sendJson(200, { hasAuth: hasValidCredentials() });
    }

    // --- API: Exit ---
    if (req.method === 'POST' && url.pathname === '/api/exit') {
        sendJson(200, { success: true });
        console.log('\n============================================');
        console.log('🎉 セットアップが完了しました！');
        console.log('ブラウザのタブを閉じて、このターミナルを終了してください。');
        console.log('次のステップ:');
        console.log('  1. ./openclaw-gemini-cli-adapter/start.sh でアダプタ起動');
        console.log('  2. npm run start で OpenClaw 起動');
        console.log('============================================\n');
        setTimeout(() => process.exit(0), 1000);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

// ============================================================
// サーバー起動 & ブラウザ自動オープン
// ============================================================
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('\n================================================================');
        console.error(`[エラー] インストーラーの起動に失敗しました（ポート ${PORT} が使用中です）`);
        console.error('================================================================');
        console.error('すでに別のインストーラーがバックグラウンドで起動しているか、');
        console.error('二重に実行しようとした可能性があります。');
        console.error('');
        console.error('【解決方法】');
        console.error('1. 現在開いているすべてのインストーラーのブラウザタブを閉じてください。');
        console.error('2. 開いている他のターミナルウィンドウがあれば閉じてください。');
        console.error(`3. それでも解決しない場合はコマンド「 kill $(lsof -t -i :${PORT}) 」でプロセスを強制終了してください。`);
        console.error('4. その後、もう一度 setup.js を実行してください。');
        console.error('================================================================\n');
    } else {
        console.error('\n================================================================');
        console.error('[エラー] 予期せぬエラーが発生しました:', err.message);
        console.error('================================================================\n');
    }
    process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nOpenClaw Gemini CLI Adapter - GUI Installer`);
    console.log(`============================================`);
    console.log(`Server running at: http://127.0.0.1:${PORT}`);
    console.log(`OpenClaw root : ${OPENCLAW_ROOT}`);
    console.log(`Plugin dir    : ${PLUGIN_DIR}`);
    console.log(`============================================\n`);

    if (!process.env.NO_AUTO_OPEN) {
        const osType = os.type();
        const openCmd = osType === 'Darwin' ? 'open' : osType === 'Windows_NT' ? 'start' : 'xdg-open';
        require('child_process').exec(`${openCmd} http://127.0.0.1:${PORT}`, (err) => {
            if (err) console.log(`Please open your browser and visit: http://127.0.0.1:${PORT}`);
        });
    }
});
