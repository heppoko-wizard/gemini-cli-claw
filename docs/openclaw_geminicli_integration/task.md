# タスクリスト: HTTPサーバー化（案B）の実装

- [x] 1. `adapter.js` をOpenAI互換HTTPサーバーとして書き直す
  - [x] POST `/v1/chat/completions` エンドポイント実装
  - [x] messagesからsystemプロンプトを分離する処理
  - [x] historyをGemini CLIセッションJSON形式に変換
  - [x] Gemini CLI作成の既存セッションファイルのmessages配列を上書き
  - [x] 最後のユーザーメッセージを -p 引数でGemini CLIに渡す
  - [x] SSEストリーミングでレスポンスを返す
  - [x] session_idをinit/resultイベントからキャプチャしてマッピング保存
- [x] 2. `openclaw.json` にOpenAI互換プロバイダとして登録
- [x] 3. アダプタサーバーの起動スクリプト (`start.sh`) を整備
- [x] 4. 動作テスト: /health, /v1/models 疎通確認
- [x] 5. 初回→2回目のセッション引き継ぎテスト成功
- [ ] 6. OpenClaw経由で実際に会話できることを確認（Telegram等）
- [ ] 7. cronタスクでpromptMode=minimalが効いているか確認
