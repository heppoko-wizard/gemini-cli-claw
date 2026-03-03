# Gemini CLI プログラム認証プロトコル・ガイド

このドキュメントでは、`gemini -login` の対話型コマンドを介さずに、プログラム（Node.jsスクリプトなど）から Gemini CLI の認証を完了させ、`oauth_creds.json` を生成する方法を解説します。

## 1. 認証の仕組み (OAuth2 + PKCE)

Gemini CLI の認証には、デスクトップアプリ向けのセキュアな認証フローである **OAuth2 + PKCE (Proof Key for Code Exchange)** が採用されています。

### なぜ前のテストは失敗したのか？ (Error 400: redirect_uri_mismatch)
Google の「コード表示ページ」(`https://codeassist.google.com/authcode`) をリダイレクト先に使う場合、Google 側で **PKCE が必須** に設定されています。
単なる OAuth2 リクエストでは「リクエストが不完全」と見なされますが、Gemini CLI と同じハッシュ値（Code Challenge）を生成して送ることで、「正規の Gemini CLI からのリクエスト」として受理されます。

## 2. 公式クレデンシャル情報

Gemini CLI 本体にハードコードされている公開情報です。これを使用することで、自分たちで作ったスクリプトを Google に「Gemini CLI 本体」として認識させることができます。

- **Client ID**: `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`
- **Client Secret**: `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`
- **Scope**:
    - `https://www.googleapis.com/auth/cloud-platform`
    - `https://www.googleapis.com/auth/userinfo.email`
    - `https://www.googleapis.com/auth/userinfo.profile`

## 3. 完全な認証スクリプト例

以下のスクリプトは、URLの生成から、ユーザーが入力したコードをトークンに変換し、Gemini CLI の正規の保存場所（`~/.gemini/oauth_creds.json`）に書き込むまでの全行程を自動化します。

```javascript
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// 公式設定
const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://codeassist.google.com/authcode';
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

async function runAuth() {
    const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);

    // 1. PKCE (Proof Key for Code Exchange) の生成
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // 2. 認証URLの生成
    const authUrl = client.generateAuthUrl({
        redirect_uri: REDIRECT_URI,
        access_type: 'offline',
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });

    console.log('\n以下のURLを開いて認証し、表示されたコードを貼り付けてください:\n');
    console.log(authUrl);

    // 3. ユーザーからのコード入力を待機
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise(resolve => rl.question('\nEnter code: ', c => { rl.close(); resolve(c.trim()); }));

    if (!code) throw new Error('コードが入力されませんでした。');

    // 4. コードをトークン（JSON）に変換
    const { tokens } = await client.getToken({
        code: code,
        codeVerifier: codeVerifier,
        redirect_uri: REDIRECT_URI
    });

    // 5. Gemini CLI の正規の場所に保存
    // Linux/Mac: ~/.gemini/oauth_creds.json
    // Windows: C:\Users\Name\.gemini\oauth_creds.json
    const targetDir = path.join(os.homedir(), '.gemini');
    const targetPath = path.join(targetDir, 'oauth_creds.json');

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    console.log(`\n✓ 認証成功！ファイルを作成しました: ${targetPath}`);
}

runAuth().catch(console.error);
```

## 4. この方法のメリット

1. **対話型UIのフリーズ回避**: Node.js プロセスとして独立して動かせるため、親アプリケーションをブロックせずに認証 URL だけを抜き出せます。
2. **ブラウザレス環境対応**: `redirect_uri` を手動モードに固定することで、サーバー上などブラウザが直接開けない環境でも完全に動作します。
3. **パスの完全制御**: `os.homedir()` を使用することで、Windows/Linux/Mac を問わず、Gemini CLI 本体が期待する場所に正確にログイン情報を配置できます。

## 5. 応用: OpenClaw への組み込み

OpenClaw の `interactive-setup.js` などでこのロジックを使用すれば、ユーザーには「認証URL」をチャットで提示し、ユーザーがコピペした「コード」を API で受け取るだけで、裏側で Gemini CLI のログインを完了させることができます。
