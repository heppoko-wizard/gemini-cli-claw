const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

// Gemini CLI's official credentials
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_SCOPE = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

async function main() {
    const client = new OAuth2Client({
        clientId: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
    });

    // --- PKCE (Proof Key for Code Exchange) の生成 ---
    // Gemini CLI が認証URLを「精巧」にするために行っている処理を再現
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

    // マニュアルモード用のリダイレクトURI
    const redirectUri = 'https://codeassist.google.com/authcode'; 
    const state = crypto.randomBytes(32).toString('hex');
    
    const authUrl = client.generateAuthUrl({
        redirect_uri: redirectUri,
        access_type: 'offline',
        scope: OAUTH_SCOPE,
        state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });

    console.log('\n=================================================');
    console.log('   Gemini CLI 認証URLテスト (PKCE対応版)');
    console.log('=================================================\n');
    console.log('以下のURLをブラウザに貼り付けてください：\n');
    console.log(authUrl);
    console.log('\n-------------------------------------------------');
    console.log('※ 今度は Google のログイン・許可画面が出るはずです。');
    console.log('※ 認証後にブラウザに「認証コード」が表示されれば成功！');
    console.log('=================================================\n');
}

main().catch(console.error);
