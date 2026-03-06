#!/usr/bin/env node
/**
 * interactive-setup.js — OpenClaw Gemini CLI Adapter
 * 全プラットフォーム対応・矢印キー選択のインタラクティブセットアップ
 *
 * すべての選択は ↑↓矢印キー + Enter で行います。
 * Y/N キー入力は一切ありません。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const https = require('https');

// --- Paths ---
const SCRIPT_DIR = __dirname;
let OPENCLAW_ROOT = path.resolve(SCRIPT_DIR, '..');
let PLUGIN_DIR = SCRIPT_DIR;

const BASENAME = path.basename(SCRIPT_DIR);
if (BASENAME !== 'openclaw-gemini-cli-adapter' && BASENAME !== 'gemini-cli-claw') {
    OPENCLAW_ROOT = SCRIPT_DIR;
    PLUGIN_DIR = path.join(SCRIPT_DIR, 'openclaw-gemini-cli-adapter');
}

const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const GEMINI_CREDS_DIR = path.join(PLUGIN_DIR, 'gemini-home');

// --- I18n ---
const MSG = {
    ja: {
        welcome: 'OpenClaw × Gemini CLI アダプタ セットアップへようこそ！',
        caution_title: '⚠️  注意: YOLOモード',
        caution_text: 'AIが自律的にファイルを操作します。重要なデータがある場所では使用しないでください。',
        env_title: '環境チェック結果',
        found: '✓ 検出',
        not_found: '✗ 未検出',
        need_install_title: '以下のセットアップが必要です:',
        confirm_install: 'すべてインストールしてセットアップを進めますか？',
        go: 'はい、すべてインストールして進める (推奨)',
        quit: '終了する',
        wait: 'インストール中です。時間がかかりますが、不安にならずにお待ちください...',
        step_openclaw: 'OpenClaw 本体の準備',
        step_deps: 'アダプタ依存関係のインストール',
        step_models: 'モデルの同期',
        step_config: '設定ファイルの更新',
        step_bun: 'Bun のインストール',
        auth_title: '🔑 Gemini CLI 認証 (Google ログイン)',
        auth_guide: [
            'ブラウザで認証を行います。',
            'すぐにタブが開くからブラウザを確認してください。',
            '自動で開かない場合は、この後に表示されるURLをブラウザに貼り付けてください。',
        ],
        auth_start: 'Enter を押して認証を開始...',
        auth_done: '✓ 認証が完了しました！',
        autostart_q: '🖥️ PCの起動（ログイン）時にOpenClawを自動起動させますか？',
        autostart_yes: 'はい、自動起動を設定する (推奨)',
        autostart_no: 'いいえ、手動で起動する',
        autostart_done: '✓ 自動起動を設定しました。',
        launch_q: '🚀 セットアップ完了！今すぐ起動しますか？',
        launch_yes: 'はい、今すぐ起動する',
        launch_no: 'いいえ、後で手動で起動する',
        launching: 'システムを起動しています...',
        done: '🎉 全ての準備が整いました！',
    },
    en: {
        welcome: 'Welcome to OpenClaw x Gemini CLI Adapter Setup!',
        caution_title: '⚠️  Warning: YOLO Mode',
        caution_text: 'AI will autonomously edit files. Do not use in environments with important data.',
        env_title: 'Environment Check',
        found: '✓ Found',
        not_found: '✗ Not found',
        need_install_title: 'The following setup is required:',
        confirm_install: 'Install everything and proceed with setup?',
        go: 'Yes, install all and proceed (Recommended)',
        quit: 'Exit',
        wait: 'Installing... This may take a while. Please be patient.',
        step_openclaw: 'Preparing OpenClaw core',
        step_deps: 'Installing adapter dependencies',
        step_models: 'Syncing models',
        step_config: 'Updating configuration',
        step_bun: 'Installing Bun',
        auth_title: '🔑 Gemini CLI Authentication (Google Login)',
        auth_guide: [
            'Authentication will be done in your browser.',
            'A new tab will open shortly, please check your browser.',
            'If it does not open automatically, copy and paste the URL shown below.',
        ],
        auth_start: 'Press Enter to start authentication...',
        auth_done: '✓ Authentication complete!',
        autostart_q: '🖥️ Enable auto-start for OpenClaw on system login?',
        autostart_yes: 'Yes, enable auto-start (Recommended)',
        autostart_no: 'No, I will start it manually',
        autostart_done: '✓ Auto-start configuration applied.',
        launch_q: '🚀 Setup complete! Launch now?',
        launch_yes: 'Yes, launch now',
        launch_no: 'No, start manually later',
        launching: 'Launching system...',
        done: '🎉 Everything is ready!',
    }
};

let lang = 'ja';
const L = () => MSG[lang];

// ========== UI Utilities ==========

function clear() { process.stdout.write('\x1Bc'); }

function up(n) { if (n > 0) process.stdout.write(`\x1b[${n}A`); }

const C = {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    magenta: (s) => `\x1b[35m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    white: (s) => `\x1b[37m${s}\x1b[0m`,
};

/**
 * 矢印キー選択 UI
 */
async function select(items, question) {
    return new Promise((resolve) => {
        let idx = 0;
        const draw = (first = false) => {
            if (!first) up(items.length + 2);
            process.stdout.write(`\r\x1b[K\n`);
            process.stdout.write(`\r\x1b[K  ${C.bold(question)}\n`);
            items.forEach((item, i) => {
                const sel = i === idx;
                const bullet = sel ? C.cyan('❯') : ' ';
                const text = sel ? C.cyan(C.bold(item)) : C.dim(item);
                process.stdout.write(`\r\x1b[K    ${bullet} ${text}\n`);
            });
        };
        const onKey = (_, key) => {
            if (!key) return;
            if (key.name === 'up') { idx = (idx - 1 + items.length) % items.length; draw(); }
            else if (key.name === 'down') { idx = (idx + 1) % items.length; draw(); }
            else if (key.name === 'return') {
                process.stdin.removeListener('keypress', onKey);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdout.write('\n');
                resolve(idx);
            }
            else if (key.ctrl && key.name === 'c') process.exit();
        };
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        draw(true);
        process.stdin.on('keypress', onKey);
    });
}

async function pressEnter(msg) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => { rl.question(`\n  ${C.bold(msg)} `, () => { rl.close(); r(); }); });
}

// ========== Logic ==========

function run(cmd, args, cwd = PLUGIN_DIR, silent = true) {
    return spawnSync(cmd, args, { cwd, shell: true, stdio: silent ? 'pipe' : 'inherit' }).status === 0;
}

function openBrowser(url) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
    try { exec(cmd); } catch { }
}

function hasCredentials() {
    return ['oauth_creds.json', 'google_accounts.json'].some(f =>
        fs.existsSync(path.join(GEMINI_CREDS_DIR, '.gemini', f))
    );
}

function isOpenclawPresent() {
    try {
        return JSON.parse(fs.readFileSync(path.join(OPENCLAW_ROOT, 'package.json'), 'utf8')).name === 'openclaw';
    } catch { return false; }
}

function isOpenclawBuilt() {
    return fs.existsSync(path.join(OPENCLAW_ROOT, 'dist', 'index.js'));
}

// ========== Main ==========

async function main() {
    clear();

    // ─── 1. 言語選択 (矢印) ───
    const langIdx = await select(['日本語 (Japanese)', 'English'], 'Select Language / 言語選択');
    lang = langIdx === 0 ? 'ja' : 'en';

    clear();
    console.log(`\n  ${C.magenta(C.bold(L().welcome))}`);
    console.log(`\n  ${C.red(C.bold(L().caution_title))}`);
    console.log(`  ${L().caution_text}`);

    // ─── 2. 環境チェック ───
    console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
    console.log(`  ${C.bold(L().env_title)}`);
    console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);

    const checks = [];

    // Node.js
    const hasNode = !!spawnSync('node', ['-v'], { shell: true, stdio: 'pipe' }).stdout?.toString().trim();
    const nodeVer = hasNode ? spawnSync('node', ['-v'], { shell: true, stdio: 'pipe' }).stdout.toString().trim() : '';
    console.log(`  ${hasNode ? C.green(`${L().found} Node.js (${nodeVer})`) : C.red(`${L().not_found} Node.js`)}`);

    // Bun
    const hasBun = !!spawnSync('bun', ['--version'], { shell: true, stdio: 'pipe' }).stdout?.toString().trim();
    console.log(`  ${hasBun ? C.green(`${L().found} Bun`) : C.yellow(`${L().not_found} Bun`)}`);
    if (!hasBun) checks.push({ key: 'bun', label: 'Bun (高速ランタイム / Fast runtime)' });

    // OpenClaw
    const ocPresent = isOpenclawPresent();
    const ocBuilt = ocPresent && isOpenclawBuilt();
    console.log(`  ${ocPresent ? C.green(`${L().found} OpenClaw`) : C.red(`${L().not_found} OpenClaw`)}`);
    if (!ocPresent) checks.push({ key: 'openclaw_dl', label: 'OpenClaw (ダウンロード + ビルド / Download + Build)' });
    else if (!ocBuilt) checks.push({ key: 'openclaw_build', label: 'OpenClaw (ビルド / Build)' });

    // Adapter deps
    const hasDeps = fs.existsSync(path.join(PLUGIN_DIR, 'node_modules'));
    console.log(`  ${hasDeps ? C.green(`${L().found} アダプタ依存関係`) : C.red(`${L().not_found} アダプタ依存関係`)}`);
    if (!hasDeps) checks.push({ key: 'deps', label: 'Gemini CLI アダプタ依存関係 (npm install)' });

    // Gemini auth
    const hasAuth = hasCredentials();
    console.log(`  ${hasAuth ? C.green(`${L().found} Gemini CLI 認証`) : C.red(`${L().not_found} Gemini CLI 認証`)}`);
    if (!hasAuth) checks.push({ key: 'auth', label: 'Gemini CLI 認証 (Google ログイン)' });

    // Google Workspace (gogcli)
    const gogBin = spawnSync('gog', ['--version'], { shell: true });
    const hasGogcli = gogBin.status === 0;
    let hasGogAuth = false;
    if (hasGogcli) {
        hasGogAuth = spawnSync('gog', ['auth', 'status', '--json'], { shell: true }).status === 0;
    }
    console.log(`  ${hasGogcli ? C.green(`${L().found} gogcli (Google Workspace CLI)`) : C.yellow(`${L().not_found} gogcli ${lang === 'ja' ? '(任意・セットアップ中にインストール可能)' : '(optional - installable during setup)'}`)}`);

    // Tailscale
    const tsBin = spawnSync('tailscale', ['status'], { shell: true });
    const hasTailscaleConnected = tsBin.status === 0;
    const hasTailscaleInstalled = !!spawnSync('tailscale', ['version'], { shell: true }).stdout?.toString().trim();
    const tsLabel = hasTailscaleConnected
        ? `${L().found} Tailscale ${lang === 'ja' ? '(接続済み)' : '(connected)'}`
        : hasTailscaleInstalled
            ? `${L().found} Tailscale ${lang === 'ja' ? '(インストール済み / 未接続)' : '(installed / not connected)'}`
            : `${L().not_found} Tailscale ${lang === 'ja' ? '(セットアップ中に自動インストール)' : '(will be auto-installed during setup)'}`;
    console.log(`  ${hasTailscaleConnected ? C.green(tsLabel) : hasTailscaleInstalled ? C.yellow(tsLabel) : C.yellow(tsLabel)}`);

    console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);

    // ─── 3. 一括確認 (矢印) ───
    if (checks.length > 0) {
        console.log(`\n  ${C.bold(L().need_install_title)}`);
        checks.forEach(c => console.log(`    • ${c.label}`));

        const choice = await select([L().go, L().quit], L().confirm_install);
        if (choice === 1) process.exit(0);
    }

    console.log(`\n  ${C.yellow(L().wait)}\n`);

    // ─── 4. インストール実行 ───

    // Bun
    if (!hasBun) {
        process.stdout.write(`  ${L().step_bun}... `);
        if (process.platform === 'win32') {
            run('powershell', ['-NoProfile', '-Command', "irm bun.sh/install.ps1 | iex"]);
        } else {
            run('curl', ['-fsSL', 'https://bun.sh/install', '|', 'bash']);
        }
        console.log(C.green('DONE'));
    }

    // OpenClaw DL
    if (!ocPresent) {
        process.stdout.write(`  ${L().step_openclaw}... `);
        // Try GitHub release ZIP first
        let ok = false;
        try {
            const info = await new Promise((resolve, reject) => {
                https.get({
                    hostname: 'api.github.com',
                    path: '/repos/openclaw/openclaw/releases/latest',
                    headers: { 'User-Agent': 'setup' }
                }, res => {
                    let b = ''; res.on('data', c => b += c);
                    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
                }).on('error', reject);
            });
            if (info.zipball_url) {
                const zip = path.join(OPENCLAW_ROOT, 'oc.zip');
                if (run('curl', ['-L', '-o', `"${zip}"`, `"${info.zipball_url}"`], OPENCLAW_ROOT)) {
                    const tmp = path.join(OPENCLAW_ROOT, '_oc_tmp');
                    fs.mkdirSync(tmp, { recursive: true });
                    const unzipCmd = process.platform === 'win32'
                        ? `powershell -Command "Expand-Archive -Force '${zip}' '${tmp}'"`
                        : `unzip -q "${zip}" -d "${tmp}"`;
                    if (run(unzipCmd, [], OPENCLAW_ROOT)) {
                        const entries = fs.readdirSync(tmp);
                        const inner = entries.length === 1 ? path.join(tmp, entries[0]) : tmp;
                        fs.cpSync(inner, OPENCLAW_ROOT, { recursive: true });
                        ok = true;
                    }
                    try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip); } catch { }
                }
            }
        } catch { }
        if (!ok) {
            const tmpGit = path.join(OPENCLAW_ROOT, '_oc_git');
            try { fs.rmSync(tmpGit, { recursive: true, force: true }); } catch { }
            if (run('git', ['clone', '--depth', '1', 'https://github.com/openclaw/openclaw.git', `"${tmpGit}"`], OPENCLAW_ROOT)) {
                try {
                    const entries = fs.readdirSync(tmpGit);
                    for (const e of entries) {
                        if (e === '.git') continue;
                        fs.cpSync(path.join(tmpGit, e), path.join(OPENCLAW_ROOT, e), { recursive: true });
                    }
                    fs.rmSync(tmpGit, { recursive: true, force: true });
                    ok = true;
                } catch (err) {
                    console.log(`\n  ${C.yellow('Warning:')} Failed to copy files from downloaded git repo: ${err}`);
                }
            }
        }
        console.log(C.green('DONE'));
    }

    // OpenClaw Build
    if (!ocBuilt) {
        console.log(`\n  ${C.bold(L().step_openclaw)} (build)...`);
        run('npm', ['install'], OPENCLAW_ROOT, false);
        if (!run('pnpm', ['--version'], OPENCLAW_ROOT)) run('npm', ['install', '-g', 'pnpm'], OPENCLAW_ROOT, false);
        run('npm', ['run', 'build'], OPENCLAW_ROOT, false);
        run('npm', ['run', 'ui:build'], OPENCLAW_ROOT, false);
        console.log(`\n  ${C.green('DONE')}`);
    }

    // Adapter deps
    if (!hasDeps) {
        console.log(`\n  ${C.bold(L().step_deps)}...`);
        run('npm', ['install'], PLUGIN_DIR, false);
        console.log(`\n  ${C.green('DONE')}`);
    }

    // Model sync
    process.stdout.write(`  ${L().step_models}... `);
    run('node', ['scripts/update_models.mjs'], PLUGIN_DIR);
    console.log(C.green('DONE'));

    // Config
    process.stdout.write(`  ${L().step_config}... `);
    try {
        let config = {};
        if (fs.existsSync(OPENCLAW_CONFIG)) config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
        else fs.mkdirSync(path.dirname(OPENCLAW_CONFIG), { recursive: true });
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.gateway) config.gateway = {};
        config.gateway.mode = 'local';
        config.agents.defaults.model = 'gemini-adapter/auto-gemini-3';
        if (config.models?.primary) delete config.models.primary;
        fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
        console.log(C.green('DONE'));
    } catch { console.log(C.red('FAIL')); }

    // Gemini settings
    const ANTIGRAVITY_SKILLS_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'skills');
    const bundledSkillsDir = path.join(GEMINI_CREDS_DIR, 'skills');
    if (fs.existsSync(bundledSkillsDir)) {
        process.stdout.write(`  スキルの配置中... `);
        try {
            fs.mkdirSync(ANTIGRAVITY_SKILLS_DIR, { recursive: true });
            const skills = fs.readdirSync(bundledSkillsDir);
            for (const skill of skills) {
                const src = path.join(bundledSkillsDir, skill);
                const dest = path.join(ANTIGRAVITY_SKILLS_DIR, skill);
                fs.cpSync(src, dest, { recursive: true });
            }
            console.log(C.green('DONE'));
        } catch (e) {
            console.log(C.red('FAIL: ' + e.message));
        }
    }

    const settingsDir = path.join(GEMINI_CREDS_DIR, '.gemini');
    fs.mkdirSync(settingsDir, { recursive: true });
    const sp = path.join(settingsDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { }

    // 報告書に基づいたフル権限・安定稼働設定を注入
    settings.model = settings.model || { name: 'auto-gemini-3' };
    settings.general = { ...settings.general, defaultApprovalMode: 'yolo' };
    settings.security = settings.security || {};
    settings.security.auth = { ...settings.security.auth, selectedType: 'oauth-personal' };
    settings.security.folderTrust = { enabled: false };
    settings.tools = { ...settings.tools, sandbox: false };

    // コンテキストにホームディレクトリを含める（フルアクセス権限）
    const home = os.homedir();
    settings.context = {
        ...settings.context,
        includeDirectories: Array.from(new Set([
            ...(settings.context?.includeDirectories || []),
            home
        ]))
    };

    fs.writeFileSync(sp, JSON.stringify(settings, null, 2));

    // (gogcli方式に移行したため、extension-enablement.json の書き換えは不要)

    // ─── 5. Gemini 認証 (同じターミナル内) ───
    if (!hasAuth) {
        console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        console.log(`  ${C.bold(L().auth_title)}`);
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        L().auth_guide.forEach(line => console.log(`  ${line}`));

        await pressEnter(L().auth_start);

        // ─── 新しいプログラム認証スクリプトを呼び出し ───
        const authScript = path.join(PLUGIN_DIR, 'scripts', 'setup-gemini-auth.js');
        if (fs.existsSync(authScript)) {
            try {
                await new Promise((resolve, reject) => {
                    const child = spawn('node', [authScript], {
                        cwd: PLUGIN_DIR,
                        env: {
                            ...process.env,
                            GEMINI_CLI_HOME: GEMINI_CREDS_DIR
                        },
                        stdio: 'inherit',
                        shell: false
                    });

                    child.on('close', (code) => {
                        if (code === 0) resolve();
                        else resolve(); // 失敗してもセットアップ処理自体は継続する仕様（後から認証可能）
                    });
                });
            } catch (e) {
                console.error(e);
            }
        } else {
            console.log(C.yellow('認証スクリプトが見つかりません。スキップします。'));
        }

        if (hasCredentials()) console.log(`\n  ${C.green(L().auth_done)}`);
    }

    // ─── 5.3. Google Workspace (gogcli) ───
    if (hasGogAuth) {
        console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        console.log(`  ${C.green('✓ Google Workspace (gogcli) は認証済みです。')}`);
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
    } else {
        const gogLabels = {
            ja: {
                q: '📊 Google Workspace（Gmail / Drive / Calendar 等）との連携を有効にしますか？',
                yes: 'はい、gogcli をインストールして Google でログインする',
                no: 'いいえ、スキップする（後から gog auth add <email> で設定可能）',
                installing: 'gogcli をインストール中...',
                install_fail: '⚠ gogcli のインストールに失敗しました。手動で https://github.com/steipete/gogcli を参照してください。',
                creds_q: 'OAuth クライアントの設定が必要です。Google Cloud Console で作成した OAuth2 クライアントの JSON ファイルのパスを入力してください（未入力でスキップ）:',
                auth_start: 'ブラウザで Google にログインしてください...',
                done: '✓ gogcli の認証が完了しました！Gmail / Drive / Calendar が利用可能です。',
                fail: '⚠ 認証に失敗しました。後から gog auth add <email> で再試行できます。',
            },
            en: {
                q: '📊 Enable Google Workspace (Gmail / Drive / Calendar etc.) integration?',
                yes: 'Yes, install gogcli and log in with Google',
                no: 'No, skip for now (run gog auth add <email> later)',
                installing: 'Installing gogcli...',
                install_fail: '⚠ Failed to install gogcli. See https://github.com/steipete/gogcli for manual install.',
                creds_q: 'OAuth client setup required. Enter the path to your OAuth2 client JSON file from Google Cloud Console (leave blank to skip):',
                auth_start: 'Please log in with Google in your browser...',
                done: '✓ gogcli authentication complete! Gmail / Drive / Calendar are now available.',
                fail: '⚠ Authentication failed. You can retry later with gog auth add <email>.',
            }
        };
        const GL = gogLabels[lang];

        console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        const gogChoice = await select([GL.yes, GL.no], GL.q);

        if (gogChoice === 0) {
            // Step 1: gogcli がなければインストール
            if (!hasGogcli) {
                console.log(`\n  ${C.cyan(GL.installing)}`);
                let installed = false;
                if (process.platform === 'darwin') {
                    // macOS: Homebrew
                    const brewResult = spawnSync('brew', ['install', 'steipete/tap/gogcli'], { stdio: 'inherit', shell: true });
                    installed = brewResult.status === 0;
                } else if (process.platform === 'linux') {
                    // Linux: GitHub Releases APIからバージョン付きURLを取得してDL
                    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
                    console.log(`  ${C.dim('GitHub API からダウンロードURLを取得中...')}`);
                    try {
                        const releaseInfo = await new Promise((resolve, reject) => {
                            https.get({
                                hostname: 'api.github.com',
                                path: '/repos/steipete/gogcli/releases/latest',
                                headers: { 'User-Agent': 'openclaw-setup' }
                            }, res => {
                                let b = ''; res.on('data', c => b += c);
                                res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
                            }).on('error', reject);
                        });
                        const asset = (releaseInfo.assets || []).find(a => a.name.includes(`linux_${arch}`) && a.name.endsWith('.tar.gz'));
                        if (asset) {
                            const dlCmd = `curl -fsSL "${asset.browser_download_url}" | tar xz -C /usr/local/bin gog`;
                            console.log(`  ${C.dim(`ダウンロード: ${asset.name}`)}`);
                            const dlResult = spawnSync('sudo', ['sh', '-c', dlCmd], { stdio: 'inherit' });
                            installed = dlResult.status === 0;
                        } else {
                            console.log(`  ${C.yellow(`linux_${arch} 用のアセットが見つかりませんでした`)}`);
                        }
                    } catch (e) {
                        console.log(`  ${C.yellow(`APIアクセス失敗: ${e.message}`)}`);
                    }
                } else if (process.platform === 'win32') {
                    // Windows: GitHub Releases APIからzip取得
                    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
                    console.log(`  ${C.dim('GitHub API からダウンロードURLを取得中...')}`);
                    try {
                        const releaseInfo = await new Promise((resolve, reject) => {
                            https.get({
                                hostname: 'api.github.com',
                                path: '/repos/steipete/gogcli/releases/latest',
                                headers: { 'User-Agent': 'openclaw-setup' }
                            }, res => {
                                let b = ''; res.on('data', c => b += c);
                                res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
                            }).on('error', reject);
                        });
                        const asset = (releaseInfo.assets || []).find(a => a.name.includes(`windows_${arch}`) && a.name.endsWith('.zip'));
                        if (asset) {
                            const tmpZip = path.join(os.tmpdir(), 'gogcli.zip');
                            const dlResult = spawnSync('powershell', ['-Command', `Invoke-WebRequest -Uri "${asset.browser_download_url}" -OutFile "${tmpZip}"; Expand-Archive -Force "${tmpZip}" -DestinationPath "C:\\Windows\\System32"; Remove-Item "${tmpZip}"`], { stdio: 'inherit', shell: true });
                            installed = dlResult.status === 0;
                        }
                    } catch (e) {
                        console.log(`  ${C.yellow(`APIアクセス失敗: ${e.message}`)}`);
                    }
                }

                if (!installed) {
                    console.log(`  ${C.yellow(GL.install_fail)}`);
                }
            }

            // Step 2: gogcli 認証
            const gogVerify = spawnSync('gog', ['--version'], { shell: true });
            if (gogVerify.status === 0) {
                console.log(`\n  ${C.cyan(GL.auth_start)}`);

                // ★ 旧エクステンション等からのシークレット(credentials.json)引き継ぎ処理 ★
                let secretFile = null;
                const searchPaths = [
                    path.join(GEMINI_CREDS_DIR, 'extensions', 'enhanced-google-workspace', 'credentials.json'),
                    path.join(GEMINI_CREDS_DIR, 'extensions', 'credentials.json'),
                    path.join(GEMINI_CREDS_DIR, 'gemini-sessions', 'default', '.gemini', 'oauth_creds.json'),
                    path.join(GEMINI_CREDS_DIR, '.gemini', 'oauth_creds.json')
                ];
                for (const p of searchPaths) {
                    if (fs.existsSync(p)) {
                        try {
                            // JSONとしてパース可能で、installedプロパティ(OAuthクライアント情報)を持つか確認
                            const content = JSON.parse(fs.readFileSync(p, 'utf8'));
                            if (content.installed && content.installed.client_id) {
                                secretFile = p;
                                console.log(`  ${C.dim(`既存のOAuthシークレットを検出しました: ${path.basename(p)}`)}`);
                                break;
                            }
                        } catch (e) { }
                    }
                }

                try {
                    // gogcliはアカウント保存用のラベルとしてemail引数を必須とするため、ダミー値を使用
                    // (実際のGoogleアカウントは開いたブラウザ側で選択可能)
                    const email = 'default@openclaw';
                    console.log(`  ${C.dim('ブラウザが開きます。連携したいGoogleアカウントを選択してください。')}`);

                    const authArgs = ['auth', 'add', email, '--services=all', '--force-consent'];
                    if (secretFile) {
                        // credentials.json が見つかった場合はクライアント情報を充てる
                        // gogcliは環境変数 GOGCLI_CLIENT_ID/SECRET を参照するので、.bashrcに記载済み
                        console.log(`  ${C.dim('既存OAuth設定（bashrcのGOGCLI_CLIENT_ID）が利用されます')}`);
                    }
                    await new Promise((resolve) => {
                        const child = spawn('gog', authArgs, {
                            stdio: 'inherit',
                            shell: true,
                        });
                        child.on('close', (code) => {
                            if (code === 0) {
                                // 認証成功後、実際のアカウントアドレスを取得してエイリアスを貼る
                                try {
                                    const stRes = spawnSync('gog', ['auth', 'status', '--json'], { shell: true });
                                    if (stRes.status === 0) {
                                        const stData = JSON.parse(stRes.stdout.toString());
                                        const realEmail = stData.account?.email;
                                        if (realEmail && realEmail !== email) {
                                            // 実メール名でエイリアス（実メアド -> default@openclaw）を張って直感的に使えるようにする
                                            spawnSync('gog', ['auth', 'alias', 'set', realEmail, email], { shell: true });
                                            // ターミナルの表示用
                                            console.log(`\n  ${C.green(GL.done)} ${C.dim(`(${realEmail})`)}`);
                                        } else {
                                            console.log(`\n  ${C.green(GL.done)}`);
                                        }
                                    } else {
                                        console.log(`\n  ${C.green(GL.done)}`);
                                    }
                                } catch (e) {
                                    console.log(`\n  ${C.green(GL.done)}`);
                                }
                            } else {
                                console.log(`\n  ${C.yellow(GL.fail)}`);
                            }
                            resolve();
                        });
                    });
                } catch (e) {
                    console.log(`\n  ${C.yellow(GL.fail)}`);
                }
            }
        }
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
    }
    // ─── 5.4. Tailscale リモートアクセス設定 (任意・全OS対応) ───
    {
        const tsLabels = {
            ja: {
                title: '🌍 Tailscale リモートアクセス',
                desc: 'Tailscale を使うと、スマホや外出先のPCから安全に OpenClaw へアクセスできます。',
                q: '🌍 Tailscale リモートアクセスを有効にしますか？',
                yes: 'はい、Tailscale をインストールしてリモートアクセスを有効にする',
                no: 'いいえ、スキップする（後から手動で設定可能）',
                installing: 'Tailscale をインストールしています（sudo パスワードが必要な場合があります）...',
                already_installed: '✓ Tailscale は既にインストール済みです。',
                already_connected: '✓ Tailscale は既にログイン済みです。',
                auth_guide: 'ブラウザが自動で開きます。お使いのアカウントでログインしてください。',
                auth_fallback: '自動で開かない場合は、以下のURLをブラウザに貼り付けてください:',
                done: '✓ Tailscale リモートアクセスが有効化されました！',
                fail: '⚠ Tailscale のセットアップに失敗しました。後から手動で設定できます。',
                timeout: '⚠ 認証がタイムアウトしました。後から sudo tailscale up で再試行できます。',
                access: 'スマホ等からのアクセス:',
                token_note: '※ 初回は「npm run openclaw -- dashboard」で表示されるToken付きURLを使用してください。',
            },
            en: {
                title: '🌍 Tailscale Remote Access',
                desc: 'Tailscale lets you securely access OpenClaw from your phone or other devices.',
                q: '🌍 Enable Tailscale remote access?',
                yes: 'Yes, install Tailscale and enable remote access',
                no: 'No, skip for now (can be set up manually later)',
                installing: 'Installing Tailscale (sudo password may be required)...',
                already_installed: '✓ Tailscale is already installed.',
                already_connected: '✓ Tailscale is already logged in.',
                auth_guide: 'A browser will open automatically. Please log in with your account.',
                auth_fallback: 'If it does not open automatically, paste the following URL in your browser:',
                done: '✓ Tailscale remote access enabled!',
                fail: '⚠ Tailscale setup failed. You can configure it manually later.',
                timeout: '⚠ Authentication timed out. You can retry later with sudo tailscale up.',
                access: 'Access from your phone:',
                token_note: '※ For first access, use the tokenized URL from "npm run openclaw -- dashboard".',
            }
        };
        const TL = tsLabels[lang];

        console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        console.log(`  ${C.bold(TL.title)}`);
        console.log(`  ${C.dim(TL.desc)}`);
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);

        const tsChoice = await select([TL.yes, TL.no], TL.q);

        if (tsChoice === 0) {
            let tsSuccess = false;
            let tsIp = '';
            let authTimedOut = false;
            try {
                // ── インストール ──
                const hasTailscale = !!spawnSync('tailscale', ['version'], { shell: true }).stdout?.toString().trim();
                if (!hasTailscale) {
                    console.log(`\n  ${C.cyan(TL.installing)}`);
                    if (process.platform === 'win32') {
                        spawnSync('winget', ['install', '--silent', 'tailscale.tailscale'], { stdio: 'inherit', shell: true });
                    } else if (process.platform === 'darwin') {
                        if (spawnSync('brew', ['install', 'tailscale'], { stdio: 'inherit', shell: true }).status !== 0) {
                            console.log(`  ${C.yellow(lang === 'ja' ? 'Homebrew が見つかりません。https://tailscale.com/download からインストールしてください。' : 'Homebrew not found. Please install from https://tailscale.com/download')}`);
                        }
                    } else {
                        // Linux: 公式インストールスクリプト (sudo が必要、stdio: inherit でパスワード入力可能)
                        // パイプ (curl | sh) だと sudo の tty が失われてハングするため、一時ファイルに保存して実行する
                        const tmpScript = path.join(os.tmpdir(), 'tailscale-install.sh');
                        spawnSync('curl', ['-fsSL', '-o', tmpScript, 'https://tailscale.com/install.sh']);
                        spawnSync('sh', [tmpScript], { stdio: 'inherit' });
                        try { fs.rmSync(tmpScript); } catch { }
                    }
                } else {
                    console.log(`  ${C.green(TL.already_installed)}`);
                }

                // ── インストール後の存在確認 ──
                const postCheck = !!spawnSync('tailscale', ['version'], { shell: true }).stdout?.toString().trim();
                if (!postCheck) {
                    throw new Error(lang === 'ja'
                        ? 'Tailscale のインストールに失敗しました（ネットワークエラーの可能性があります）'
                        : 'Tailscale installation failed (possibly a network error)');
                }

                // ── tailscaled デーモンの起動確認 ──
                if (process.platform !== 'win32') {
                    const daemonCheck = spawnSync('tailscale', ['status'], { shell: true, stdio: 'pipe' });
                    const daemonStderr = daemonCheck.stderr?.toString() || '';
                    if (daemonCheck.status !== 0 && (daemonStderr.includes('appear to be running') || daemonStderr.includes('not running'))) {
                        console.log(`  ${C.cyan(lang === 'ja' ? 'tailscaled デーモンを起動しています...' : 'Starting tailscaled daemon...')}`);

                        // PID 1 が systemd かどうかで起動方法を分岐
                        let pid1 = '';
                        try { pid1 = fs.readFileSync('/proc/1/comm', 'utf8').trim(); } catch { }
                        const isSystemd = pid1 === 'systemd';

                        if (isSystemd) {
                            spawnSync('sudo', ['systemctl', 'daemon-reload'], { stdio: 'inherit' });
                            spawnSync('sudo', ['systemctl', 'enable', '--now', 'tailscaled'], { stdio: 'inherit' });
                        } else {
                            // WSL2 等 systemd 非対応環境: 直接バックグラウンド起動
                            console.log(`  ${C.dim(lang === 'ja' ? 'systemd が無効のため、直接デーモンを起動します...' : 'systemd not active, starting daemon directly...')}`);
                            spawnSync('sudo', ['killall', 'tailscaled'], { stdio: 'ignore' });
                            spawnSync('sudo', ['sh', '-c', 'tailscaled > /dev/null 2>&1 &'], { stdio: 'inherit' });
                        }

                        // 起動待ち + 確認
                        spawnSync('sleep', ['3']);
                        const recheck = spawnSync('tailscale', ['status'], { shell: true, stdio: 'pipe' });
                        if (recheck.stderr?.toString().includes('appear to be running') || recheck.stderr?.toString().includes('not running')) {
                            throw new Error(lang === 'ja'
                                ? 'tailscaled デーモンの起動に失敗しました'
                                : 'Failed to start tailscaled daemon');
                        }
                    }
                }

                // ── 接続チェック ──
                const tsStatus = spawnSync('tailscale', ['status'], { shell: true });
                const alreadyConnected = tsStatus.status === 0;

                if (alreadyConnected) {
                    console.log(`  ${C.green(TL.already_connected)}`);
                    tsSuccess = true;
                } else {
                    // ── 認証（ログイン）──
                    console.log(`\n  ${C.yellow(TL.auth_guide)}`);
                    const upCmd = process.platform === 'win32' ? 'tailscale' : 'sudo';
                    const upArgs = process.platform === 'win32' ? ['up'] : ['tailscale', 'up'];
                    // stdin: inherit でsudoパスワード入力可能、stdout/stderr: pipe でURL検出
                    const upProcess = spawn(upCmd, upArgs, { stdio: ['inherit', 'pipe', 'pipe'] });

                    const AUTH_TIMEOUT_MS = 90_000;

                    await new Promise((resolve) => {
                        const timer = setTimeout(() => {
                            authTimedOut = true;
                            try { upProcess.kill('SIGTERM'); } catch { }
                            setTimeout(() => {
                                try { upProcess.kill('SIGKILL'); } catch { }
                            }, 3000);
                            resolve();
                        }, AUTH_TIMEOUT_MS);

                        const handleOutput = (d) => {
                            const s = d.toString();
                            // 認証URL以外の通常出力もターミナルに表示
                            process.stderr.write(C.dim(s));
                            const urlMatch = s.match(/(https?:\/\/[^\s]+)/);
                            if (urlMatch) {
                                console.log(`\n  ${C.dim(TL.auth_fallback)}`);
                                console.log(`  🔗 ${C.cyan(urlMatch[1])}`);
                                openBrowser(urlMatch[1]);
                            }
                        };
                        if (upProcess.stdout) upProcess.stdout.on('data', handleOutput);
                        if (upProcess.stderr) upProcess.stderr.on('data', handleOutput);

                        upProcess.on('close', (code) => {
                            clearTimeout(timer);
                            if (!authTimedOut) {
                                tsSuccess = code === 0;
                                resolve();
                            }
                        });
                    });

                    if (authTimedOut) {
                        console.log(`\n  ${C.yellow(TL.timeout)}`);
                    }
                }

                if (tsSuccess) {
                    // IP取得
                    const ipOut = spawnSync('tailscale', ['ip', '-4'], { shell: true }).stdout?.toString().trim();
                    if (ipOut) tsIp = ipOut.split('\n')[0];

                    // UFW 設定（Linux かつ有効な場合のみ）
                    if (process.platform === 'linux') {
                        const ufwStatus = spawnSync('sudo', ['ufw', 'status'], { stdio: 'pipe', shell: true }).stdout?.toString();
                        if (ufwStatus && ufwStatus.includes('Status: active')) {
                            console.log(`  ${C.cyan(lang === 'ja' ? 'ファイアウォール（UFW）に許可ルールを追加しています...' : 'Adding firewall allow rule...')}`);
                            spawnSync('sudo', ['ufw', 'allow', 'in', 'on', 'tailscale0', 'to', 'any', 'port', '18789'], { stdio: 'inherit', shell: true });
                        }
                    }
                    console.log(`\n  ${C.green(TL.done)}`);
                    if (tsIp) {
                        console.log(`  ${C.bold('🚀 ' + TL.access)}`);
                        console.log(`     ${C.cyan(`http://${tsIp}:18789`)}`);
                        console.log(`  ${C.gray(TL.token_note)}\n`);
                    }
                } else if (!authTimedOut) {
                    console.log(`\n  ${C.yellow(TL.fail)}`);
                }
            } catch (e) {
                console.log(`\n  ${C.yellow(TL.fail)}: ${e.message}`);
            }
        }
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
    }

    // ─── 5.5. 自動起動設定確認 (矢印) ───
    const autoIdx = await select([L().autostart_yes, L().autostart_no], L().autostart_q);
    if (autoIdx === 0) {
        try {
            if (process.platform === 'win32') {
                const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
                fs.mkdirSync(startupDir, { recursive: true });
                const vbsPath = path.join(startupDir, 'openclaw-gemini-adapter.vbs');
                const vbsCode = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.CurrentDirectory = "${PLUGIN_DIR}"\nWshShell.Run "cmd /c launch.bat", 0\n`;
                fs.writeFileSync(vbsPath, vbsCode);
            } else if (process.platform === 'darwin') {
                const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
                fs.mkdirSync(plistDir, { recursive: true });
                const plistPath = path.join(plistDir, 'com.openclaw.gemini.plist');
                const plistCode = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.gemini</string>
    <key>ProgramArguments</key>
    <array>
        <string>${path.join(PLUGIN_DIR, 'launch.sh')}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${PLUGIN_DIR}</string>
</dict>
</plist>`;
                fs.writeFileSync(plistPath, plistCode);
            } else {
                // Linux
                const autostartDir = path.join(os.homedir(), '.config', 'autostart');
                fs.mkdirSync(autostartDir, { recursive: true });
                const desktopPath = path.join(autostartDir, 'openclaw-gemini.desktop');
                const desktopCode = `[Desktop Entry]
Type=Application
Exec=${path.join(PLUGIN_DIR, 'launch.sh')}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name[en_US]=OpenClaw & Gemini Adapter
Name=OpenClaw & Gemini Adapter
Comment=Starts OpenClaw Gateway and Gemini CLI Adapter
`;
                fs.writeFileSync(desktopPath, desktopCode);
                fs.chmodSync(desktopPath, 0o755);
            }
            console.log(`\n  ${C.green(L().autostart_done)}`);
        } catch (e) {
            console.log(`\n  ${C.red('FAIL: ' + e.message)}`);
        }
    }

    // ─── 6. 起動確認 (矢印) ───
    const launchIdx = await select([L().launch_yes, L().launch_no], L().launch_q);

    if (launchIdx === 0) {
        console.log(`\n  ${C.magenta(L().launching)}\n`);

        const startScript = process.platform === 'win32' ? 'launch.bat' : './launch.sh';
        const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
        const shellArg = process.platform === 'win32' ? '/c' : '-c';

        // launch.sh / launch.bat が Gateway 起動を待ち、dashboard コマンドで安全にブラウザを開く
        spawnSync(shell, [shellArg, startScript], { cwd: PLUGIN_DIR, stdio: 'inherit' });
    }

    console.log(`\n  ${C.bold(C.green(L().done))}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
