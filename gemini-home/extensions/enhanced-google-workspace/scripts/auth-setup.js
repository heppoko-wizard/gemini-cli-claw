/**
 * Google Workspace 拡張機能 - セットアップ用認証スクリプト
 * 
 * このスクリプトを実行すると、ブラウザが自動で開き、Google アカウントの認証を行います。
 * 認証が完了すると、トークンがローカルに保存され、スクリプトは終了します。
 * 
 * 【開発モード】ts-node を使って TypeScript ソースを直接読み込んでいます。
 * 【配布モード】配布時のビルド方法は BUNDLE_GUIDE.md を参照してください。
 */

// ts-node を使って TypeScript ソースを直接実行できるようにする
const tsNode = require('ts-node');
tsNode.register({
  project: require('path').join(__dirname, '../workspace-server/tsconfig.json'),
  transpileOnly: true, // 型チェックをスキップして高速化
});

const { AuthManager } = require('../workspace-server/src/auth/AuthManager');

// 要求する全スコープ
const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.memberships',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts'
];

const { OAuthCredentialStorage } = require('../workspace-server/src/auth/token-storage/oauth-credential-storage');

async function runSetup() {
  const isCheckMode = process.argv.includes('--check');

  try {
    const creds = await OAuthCredentialStorage.loadCredentials();
    const hasCreds = creds && creds.refresh_token;

    if (isCheckMode) {
      if (hasCreds) process.exit(0);
      else process.exit(1);
    }

    console.log('\n--- Google Workspace Setup ---');
    if (hasCreds) {
      console.log('✅ 既に認証済みです（OSキーチェーンからトークンを取得しました）。');
      process.exit(0);
    }

    console.log('認証を開始します。ブラウザを確認してください...');

    const authManager = new AuthManager(SCOPES);
    await authManager.startAuthFlow();
    
    console.log('\n✅ セットアップが完了しました！');
    process.exit(0);
  } catch (error) {
    if (isCheckMode) process.exit(1);
    console.error('\n❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

runSetup();
