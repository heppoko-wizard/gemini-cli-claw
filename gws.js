#!/usr/bin/env node

/**
 * Google Workspace (gogcli) Wrapper for OpenClaw Adapter
 * 
 * Usage:
 *   node gws.js login <email>  (Authorize a new account)
 *   node gws.js list           (List authorized accounts)
 *   node gws.js status         (Check auth status)
 *   node gws.js <command>      (Run any gog command)
 */

const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const readline = require('readline');

const containerName = 'openclaw-gemini-adapter';
const DEFAULT_KEYRING_PASS = 'openclaw-adapter';

/**
 * 共通の環境変数を取得
 */
function getGogEnv() {
    return {
        ...process.env,
        GOG_KEYRING_BACKEND: 'file',
        GOG_KEYRING_PASSWORD: process.env.GOG_KEYRING_PASSWORD || DEFAULT_KEYRING_PASS
    };
}

/**
 * 実行環境に応じた gogcli (gog) の実行方法を解決する
 */
function resolveGogExecutable() {
    try {
        const running = execSync(`docker ps -q --filter name=${containerName}`, { encoding: 'utf-8' }).trim();
        if (running) return 'DOCKER_EXEC';
    } catch (_) {}

    const paths = [
        path.join(__dirname, 'gog'),
        '/usr/local/bin/gog',
        'gog'
    ];
    for (const p of paths) {
        try {
            if (p === 'gog') {
                execSync('gog version', { stdio: 'ignore' });
                return 'gog';
            }
            if (fs.existsSync(p)) return p;
        } catch (_) {}
    }
    return null;
}

/**
 * gogcli の鍵 (credentials.json) が登録されているか確認し、
 * 未登録ならホスト側のファイルをコンテナに転送して登録を試みる。
 */
function ensureCredentials(exe) {
    if (exe !== 'DOCKER_EXEC') return;

    try {
        const res = execSync(`docker exec -e GOG_KEYRING_BACKEND=file -e GOG_KEYRING_PASSWORD=${DEFAULT_KEYRING_PASS} ${containerName} gog auth status --json`, { encoding: 'utf-8' });
        const status = JSON.parse(res);
        if (!status.account.credentials_exists) {
            console.log('🔑 gogcli credentials not found in container. Registering...');
            const hostCreds = path.join(__dirname, 'credentials.json');
            if (fs.existsSync(hostCreds)) {
                execSync(`docker exec ${containerName} mkdir -p /root/.config/gogcli`);
                execSync(`docker cp "${hostCreds}" ${containerName}:/root/.config/gogcli/credentials.json`);
                execSync(`docker exec -e GOG_KEYRING_BACKEND=file -e GOG_KEYRING_PASSWORD=${DEFAULT_KEYRING_PASS} ${containerName} gog auth credentials /root/.config/gogcli/credentials.json`);
                console.log('✅ Registered credentials.json from host.');
            } else {
                console.error('❌ Error: credentials.json not found on host.');
                console.log('Please ensure the "credentials.json" file exists in the project root.');
                process.exit(1);
            }
        }
    } catch (e) {}
}

/**
 * OAuth URL をキャプチャして短縮 URL を提供する特殊なログイン処理
 */
async function handleLogin(exe, email) {
    ensureCredentials(exe);

    const scopes = [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/contacts'
    ];

    const authArgs = ['auth', 'add', email, '--services', 'people', '--extra-scopes', scopes.join(','), '--force-consent'];
    let spawnArgs = exe === 'DOCKER_EXEC' 
        ? ['exec', '-i', '-e', 'GOG_KEYRING_BACKEND=file', '-e', `GOG_KEYRING_PASSWORD=${DEFAULT_KEYRING_PASS}`, containerName, 'gog', ...authArgs] 
        : authArgs;
    let spawnCmd = exe === 'DOCKER_EXEC' ? 'docker' : exe;
    let spawnEnv = exe === 'DOCKER_EXEC' ? process.env : getGogEnv();

    console.log('🚀 Starting login process...');
    console.log('   Waiting for OAuth URL from gogcli...');

    const child = spawn(spawnCmd, spawnArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let outputBuffer = '';
    let urlCaptured = false;
    let redirectServer = null;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n  💡 【SSH/WSL等で接続拒否になった場合】');
    console.log('  ブラウザで認証完了後に "127.0.0.1 接続を拒否しました" と出たら、');
    console.log('  そのアドレスバーのURLをコピーしてここに貼り付けてください。\n');

    const showPrompt = () => {
        rl.setPrompt('  URL貼り付け待ち > ');
        rl.prompt();
    };

    const handleData = (data) => {
        const text = data.toString();
        process.stdout.write(text); // そのまま出力
        outputBuffer += text;

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
                    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('🔗 ↓ クリックして認証 (短縮URL)');
                    console.log(`\x1b[1m\x1b[36m  ${shortUrl}\x1b[0m`);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    showPrompt();
                });
            }
        }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    rl.on('line', (line) => {
        const input = line.trim();
        if (input.startsWith('http')) {
            // URLが入力されたら、内部的に curl を叩いて callback を完結させる
            console.log('   Pasted URL detected. Finalizing callback...');
            spawnSync('curl', ['-s', '-I', input]);
        }
    });

    child.on('exit', (code) => {
        if (redirectServer) redirectServer.close();
        rl.close();
        if (code === 0) {
            console.log('\n✅ Login successful and token stored!');
        } else {
            console.error(`\n❌ Login failed (Exit code: ${code})`);
            console.log('   Hint: Keyring password error? Check GOG_KEYRING_PASSWORD.');
        }
        process.exit(code);
    });
}

const gogExe = resolveGogExecutable();
const args = process.argv.slice(2);

async function main() {
    if (!gogExe) {
        console.error('❌ Error: gogcli (gog command) not found.');
        process.exit(1);
    }

    if (args[0] === 'login') {
        const email = args[1];
        if (!email) {
            console.error('❌ Usage: node gws.js login <email>');
            process.exit(1);
        }
        await handleLogin(gogExe, email);
    } else {
        // 通常のコマンド実行
        const finalArgs = [...args];
        if (args[0] === 'list') finalArgs.splice(0, 1, 'auth', 'list');
        else if (args[0] === 'status') finalArgs.splice(0, 1, 'auth', 'status');

        if (gogExe === 'DOCKER_EXEC') {
            console.log(`🐳 Executing gogcli inside ${containerName}...`);
            spawn('docker', [
                'exec', '-it', 
                '-e', 'GOG_KEYRING_BACKEND=file', 
                '-e', `GOG_KEYRING_PASSWORD=${DEFAULT_KEYRING_PASS}`, 
                containerName, 'gog', ...finalArgs
            ], { stdio: 'inherit' })
                .on('exit', code => process.exit(code));
        } else {
            spawn(gogExe, finalArgs, { stdio: 'inherit', shell: true, env: getGogEnv() })
                .on('exit', code => process.exit(code));
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
