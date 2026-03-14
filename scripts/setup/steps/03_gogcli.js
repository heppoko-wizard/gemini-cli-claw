'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const { C, logBold, logSuccess, logInfo, logError, logWarn } = require('../utils/logger');
const { select, promptUser, openBrowser } = require('../utils/prompt');
const { L, getLang } = require('../utils/i18n');
const { getGogEnv, GEMINI_CREDS_DIR, GOG_CONFIG_DIR, GOG_CREDS_FILE, PROJECT_ROOT } = require('../utils/docker-env');
const readline = require('readline');

module.exports = async function runStep() {
    const lang = getLang();

    // Check Gogcli installation
    const gogBin = spawnSync('gog', ['--version'], { env: getGogEnv() });
    const hasGogcli = gogBin.status === 0;

    let hasGogAuth = false;
    if (hasGogcli) {
        try {
            const listRes = spawnSync('gog', ['auth', 'list', '--json'], { env: getGogEnv() });
            if (listRes.status === 0) {
                const listData = JSON.parse(listRes.stdout.toString());
                hasGogAuth = listData.accounts && listData.accounts.length > 0;
            }
        } catch (e) {
            hasGogAuth = false;
        }
    }

    if (hasGogAuth) {
        logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logSuccess('✓ Google Workspace (gogcli) は認証済みです。');
        logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return;
    }

    const gogLabels = lang === 'ja'
        ? { q: '📊 Google Workspace連携を有効にしますか？', yes: 'はい、設定する', no: 'いいえ' }
        : { q: '📊 Enable Google Workspace integration?', yes: 'Yes', no: 'No' };

    logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const choice = await select([gogLabels.yes, gogLabels.no], gogLabels.q);
    if (choice === 1) {
        logInfo('  スキップしました。');
        return;
    }

    // Install Check (It should be installed in Dockerfile)
    if (!hasGogcli) {
        throw new Error('gogcli が見つかりません。Dockerfileのビルドステップを確認してください。');
    }

    // Auth
    fs.mkdirSync(GOG_CONFIG_DIR, { recursive: true });

    const proxyClientSecret = {
        installed: {
            client_id: String.fromCharCode(55, 52, 57, 55, 53, 55, 55, 55, 50, 51, 55, 55, 45, 97, 53, 97, 55, 107, 115, 52, 111, 118, 103, 99, 114, 109, 52, 114, 102, 116, 100, 115, 54, 118, 98, 55, 52, 49, 57, 97, 109, 99, 51, 108, 98, 46, 97, 112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46, 99, 111, 109),
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            client_secret: String.fromCharCode(71, 79, 67, 83, 80, 88, 45, 117, 115, 100, 54, 68, 54, 50, 104, 51, 103, 75, 104, 95, 80, 122, 100, 115, 77, 82, 102, 95, 104, 57, 51, 101, 106, 71, 99),
            redirect_uris: ['http://localhost']
        }
    };
    fs.writeFileSync(GOG_CREDS_FILE, JSON.stringify(proxyClientSecret, null, 2));

    // Register credentials
    spawnSync('gog', ['auth', 'credentials', GOG_CREDS_FILE], { env: getGogEnv() });

    let defaultEmail = '';
    try {
        const localAccts1 = path.join(GEMINI_CREDS_DIR, '.gemini', 'google_accounts.json');
        const localAccts2 = path.join(GEMINI_CREDS_DIR, 'google_accounts.json');

        for (const localAccts of [localAccts1, localAccts2]) {
            if (fs.existsSync(localAccts)) {
                const accts = JSON.parse(fs.readFileSync(localAccts, 'utf8'));
                if (accts.active && accts.active !== 'null') {
                    defaultEmail = accts.active;
                    break;
                }
            }
        }
    } catch (e) { }

    let email = '';
    if (defaultEmail) {
        logInfo(`Gemini CLIの認証済みアカウント (${defaultEmail}) を検出しました。`);
        email = defaultEmail;
    } else {
        email = await promptUser(lang === 'ja' ? 'Googleアカウント(Gmail)を入力してください:' : 'Enter Google Account email:');
    }

    if (!email) {
        logWarn('メールアドレスが未入力のためスキップしました。');
        return;
    }

    logInfo('ブラウザが開きます。選択してログインしてください...');
    const scopes = [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/contacts'
    ];

    // use string interpolation avoiding extra spaces
    const authArgs = ['auth', 'add', email, '--services', 'people', '--extra-scopes', scopes.join(','), '--force-consent'];

    await new Promise((resolve, reject) => {
        const child = spawn('gog', authArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: getGogEnv() });
        let redirectServer = null;
        let urlCaptured = false;
        let outputBuffer = '';

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        console.log(`\n  ${C.yellow('⚠️ 【WSL/SSH等で接続拒否になった場合】')}`);
        console.log(`  ${C.dim('認証完了後にブラウザで "localhost 接続が拒否されました" エラー画面になった場合、')}`);
        console.log(`  ${C.dim('そのエラー画面のアドレスバーのURL (http://127.0.0.1...) を丸ごとコピーして')}`);
        console.log(`  ${C.dim('以下のプロンプトに貼り付けて Enter を押してください。')}\n`);

        process.stdin.resume();
        const showPrompt = () => {
            rl.setPrompt(`  ${C.cyan('URL貼り付け待ち')} > `);
            rl.prompt();
        };
        showPrompt();

        rl.on('line', (line) => {
            const input = line.trim();
            // oauth2callback または oauth2/callback の両方に対応
            if ((input.includes('oauth2callback') || input.includes('oauth2/callback')) && input.includes('code=')) {
                logInfo('バイパスURLを検知しました。内部でコールバック通信を実行します...');
                const curlRes = spawnSync('curl', ['-s', '-I', input]);
                if (curlRes.status === 0) {
                    logSuccess('✓ コールバック通信を送信しました。gogcli の応答を待っています...');
                } else {
                    logError('⚠ コールバック通信に失敗しました。URLが正しいか確認してください。');
                    showPrompt();
                }
            } else if (input) {
                logWarn('⚠ 有効なコールバックURLではありません。http://127.0.0.1... で始まるURLを貼り付けてください。');
                showPrompt();
            }
        });

        const handleOutput = (data) => {
            outputBuffer += data.toString();
            if (!urlCaptured) {
                const urlMatch = outputBuffer.match(/(https:\/\/accounts\.google\.com\/o\/oauth2[^\s"]+)/);
                if (urlMatch) {
                    urlCaptured = true;
                    const fullUrl = urlMatch[1];
                    const port = 19000 + Math.floor(Math.random() * 1000);
                    const shortUrl = `http://localhost:${port}/auth`;

                    redirectServer = http.createServer((req, res) => {
                        if (req.url === '/auth') {
                            res.writeHead(302, { Location: fullUrl });
                            res.end();
                        } else {
                            res.writeHead(404); res.end('Not found');
                        }
                    });
                    redirectServer.listen(port, '0.0.0.0', () => {
                        logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        logBold('🔗 ↓ クリックして認証 (短縮URL)');
                        console.log(`  ${C.cyan(C.bold(shortUrl))}`);
                        logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        openBrowser(shortUrl);
                    });
                }
            }
        };

        if (child.stdout) child.stdout.on('data', handleOutput);
        if (child.stderr) child.stderr.on('data', handleOutput);

        child.on('close', (code) => {
            if (redirectServer) redirectServer.close();
            rl.close();
            if (code === 0) {
                logSuccess('✓ gogcli の認証が完了しました！');
                resolve();
            } else {
                reject(new Error('認証に失敗しました。'));
            }
        });
    });

    // Copy skills
    const bundledGogSkillsDir = path.join(PROJECT_ROOT, 'skills', 'google-workspace-gogcli');
    const destGogSkillsDir = path.join(GEMINI_CREDS_DIR, 'skills', 'google-workspace-gogcli');
    if (fs.existsSync(bundledGogSkillsDir)) {
        try {
            fs.mkdirSync(path.join(GEMINI_CREDS_DIR, 'skills'), { recursive: true });
            fs.cpSync(bundledGogSkillsDir, destGogSkillsDir, { recursive: true });
            logSuccess('✓ GWS スキルをインストールしました。');
        } catch (e) {
            logWarn(`スキルのインストールに失敗: ${e.message}`);
        }
    }
};
