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
            'このターミナルに Gemini CLI の認証画面が表示されます。',
            '',
            '  ↑↓ 矢印キーで「Login with Google」を選択',
            '  Enter キーで確定',
            '  → ブラウザが自動で開きます',
            '  → Google アカウントでログインしてください',
            '  → 完了したらこのターミナルに戻ってください',
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
            'A Gemini CLI auth screen will appear in this terminal.',
            '',
            '  Use ↑↓ arrow keys to select "Login with Google"',
            '  Press Enter to confirm',
            '  → A browser will open automatically',
            '  → Log in with your Google account',
            '  → Return to this terminal when done',
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
        if (process.platform !== 'win32') {
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
                    try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip); } catch {}
                }
            }
        } catch {}
        if (!ok) run('git', ['clone', '--depth', '1', 'https://github.com/openclaw/openclaw.git', `"${OPENCLAW_ROOT}"`], OPENCLAW_ROOT);
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
    const settingsDir = path.join(GEMINI_CREDS_DIR, '.gemini');
    fs.mkdirSync(settingsDir, { recursive: true });
    const sp = path.join(settingsDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch {}
    
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

    // ─── 5. Gemini 認証 (同じターミナル内) ───
    if (!hasAuth) {
        console.log(`\n  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        console.log(`  ${C.bold(L().auth_title)}`);
        console.log(`  ${C.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
        L().auth_guide.forEach(line => console.log(`  ${line}`));

        await pressEnter(L().auth_start);

        // ─── patch_gemini.js を適用（OPENCLAW_AUTO_CONSENTを有効化し [Y/n] を自動同意） ───
        const patchPath = path.join(PLUGIN_DIR, 'patch_gemini.js');
        if (fs.existsSync(patchPath)) {
            try { require(patchPath); } catch(e) {}
        }

        const gemBin = path.join(PLUGIN_DIR, 'node_modules', '.bin', 'gemini' + (process.platform === 'win32' ? '.cmd' : ''));
        const cmd = fs.existsSync(gemBin) ? gemBin : 'gemini';

        let child;
        try {
            await new Promise((resolve) => {
                child = spawn(cmd, [], {
                    cwd: PLUGIN_DIR,
                    env: {
                        ...process.env,
                        GEMINI_CLI_HOME: GEMINI_CREDS_DIR,
                        OPENCLAW_AUTO_CONSENT: 'true',
                        TERM: 'dumb',
                    },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let done = false;

                const checkDone = (data) => {
                    const str = data.toString();
                    process.stdout.write(str);

                    // [Y/n] 系のプロンプトが出たら自動で y を送信
                    if (/\[Y\/n\]|\[y\/n\]/i.test(str)) {
                        child.stdin.write('y\n');
                    }

                    // 認証成功を検知 → 2秒後に自動終了
                    if (!done && (
                        str.includes('Authentication succeeded') ||
                        str.includes('認証が完了') ||
                        str.includes('Logged in as') ||
                        str.includes('Login successful')
                    )) {
                        done = true;
                        setTimeout(() => {
                            try {
                                if (process.platform === 'win32') {
                                    spawnSync('taskkill', ['/pid', child.pid, '/f', '/t']);
                                } else {
                                    child.kill('SIGKILL');
                                }
                            } catch (e) {}
                            resolve();
                        }, 2000);
                    }
                };

                child.stdout.on('data', checkDone);
                child.stderr.on('data', checkDone);

                child.on('close', () => {
                    if (!done) resolve();
                });
            });
        } catch (e) {
            console.error(e);
        }

        if (hasCredentials()) console.log(`\n  ${C.green(L().auth_done)}`);
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
