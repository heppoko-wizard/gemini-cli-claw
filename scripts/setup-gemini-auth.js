const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const url = require('url');

async function openBrowser(targetUrl) {
    const { exec } = require('child_process');
    let command;
    switch (process.platform) {
        case 'darwin': command = `open "${targetUrl}"`; break;
        case 'win32': command = `start "" "${targetUrl}"`; break;
        default: command = `xdg-open "${targetUrl}"`; break;
    }
    exec(command, (err) => {
        if (err) {
            console.log('\nブラウザを自動で開けませんでした。以下のURLを手動で開いてください:\n');
            console.log(targetUrl);
        }
    });
}

const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

async function runAuth() {
    return new Promise((resolve, reject) => {
        const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
        
        // ランダムなポートでローカルサーバーを起動
        const server = http.createServer();
        server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;
            const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
            
            const state = crypto.randomBytes(32).toString('hex');
            const authUrl = client.generateAuthUrl({
                redirect_uri: redirectUri,
                access_type: 'offline',
                scope: SCOPES,
                state,
            });

            console.log('\n  ブラウザで Google 認証を完了してください...');
            console.log(`  🔗 ${authUrl}\n`);
            await openBrowser(authUrl);

            server.on('request', async (req, res) => {
                try {
                    const reqUrl = new url.URL(req.url, `http://127.0.0.1:${port}`);
                    
                    if (reqUrl.pathname !== '/oauth2callback') {
                        res.writeHead(404);
                        res.end('Not Found');
                        return;
                    }

                    const code = reqUrl.searchParams.get('code');
                    const err = reqUrl.searchParams.get('error');
                    const returnedState = reqUrl.searchParams.get('state');

                    if (err) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>認証エラー</h1><p>ブラウザを閉じてターミナルを確認してください。</p>');
                        reject(new Error(`Google OAuth error: ${err}`));
                        server.close();
                        return;
                    }

                    if (returnedState !== state) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>セキュリティエラー</h1><p>状態が一致しません。CSRF攻撃の可能性があります。</p>');
                        reject(new Error('State mismatch'));
                        server.close();
                        return;
                    }

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>認証成功！</h1><p>Gemini CLI の認証が完了しました。このタブ・ウィンドウは閉じて構いません。</p><script>window.close();</script>');
                        
                        // トークンを取得
                        const { tokens } = await client.getToken({
                            code,
                            redirect_uri: redirectUri,
                        });
                        
                        // GEMINI_CLI_HOME があればそこを優先、なければ os.homedir() の ~/.gemini に保存
                        const baseDir = process.env.GEMINI_CLI_HOME || os.homedir();
                        const targetDir = path.join(baseDir, '.gemini');
                        const targetPath = path.join(targetDir, 'oauth_creds.json');
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }
                        fs.writeFileSync(targetPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
                        
                        server.close();
                        resolve();
                    } else {
                        res.writeHead(400);
                        res.end('No code provided');
                        reject(new Error('No authorization code provided'));
                        server.close();
                    }
                } catch (e) {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                    reject(e);
                    server.close();
                }
            });
        });
        
        server.on('error', (err) => {
            reject(err);
        });
    });
}

runAuth().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error(`\n  認証失敗: ${err.message}`);
    process.exit(1);
});
