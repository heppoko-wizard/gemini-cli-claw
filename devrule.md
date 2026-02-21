# OpenClaw ↔ Gemini CLI Adapter 開発・デバッグルール

## 1. コンポーネントの起動方法

Gemini CLIをOpenClawから利用するには、2つのプロセスを起動する必要があります。

### A: Gemini CLI アダプタサーバー
- **役割**: ポート `3972` で動作し、OpenClawからのリクエストをGemini CLIコマンドに変換する。
- **起動コマンド**:
  ```bash
  /home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw/start.sh
  ```
  ※ プロセスが残っているか確認・強制終了する場合は `kill $(lsof -t -i :3972)`

### B: OpenClaw ゲートウェイ
- **役割**: クライアント（Telegram等）からのメッセージを受け付け、設定されたモデルプロバイダへ転送する。
- **起動コマンド**:
  ```bash
  cd /home/heppo/ドキュメント/DEV/openclaw
  npm run start
  # または特定ポートで起動する場合
  # node openclaw.mjs gateway --port 18789
  ```

## 2. ログと履歴の確認場所

問題発生時は「どこで」「どんなデータが」消失・変異しているかをトレースするために以下の3箇所全てを確認すること。

### ① OpenClaw ゲートウェイ側のログと履歴
- **ログ**: `npm run start` の標準出力、または `openclaw-gateway.log`
- **確認内容**: Telegramからメッセージを受信しているか、ターゲットプロバイダへのルーティングが正しく行われているか。
- **セッション履歴**: `~/.openclaw/sessions/` 内の該当セッションファイル（JSON）

### ② Gemini CLI アダプタ側のログ
- **ログ**: `/home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw/adapter.log`
- **確認内容**:
  - `Incoming request: POST /responses` などの着信記録
  - `Request body: {...}` の中身（OpenClawからどんなフォーマットで履歴が送られてきているか。例: `messages` か `input` か）
  - 生成された `gemini` コマンドの引数内容

### ③ Gemini CLI 側の内部セッション
- **UUIDマッピング**: `~/.openclaw/gemini-session-map.json` (OpenClawのセッションキーとGemini CLIが生成したUUIDの紐付け)
- **セッションファイル**: `~/.openclaw/gemini-sessions/<sessionKey>/.gemini/tmp/gemini-cli-claw/chats/session-*.json`
- **確認内容**: アダプタが正しくOpenClawの履歴をこのファイルに注入（上書き）できているか。

## 3. 問題解決フロー（トラブルシューティング）

1. **Telegram（クライアント）で応答がない場合:**
   - アダプタのログ（`adapter.log`）を見る。リクエストが来ていなければ、OpenClaw側のルーティング設定かポート設定の問題。
2. **アダプタにリクエストは来ているがGeminiが空応答の場合:**
   - アダプタのログで `Request body` を確認する。本文が `messages` に入っているか、`input` に入っているか等、JSONのスキーマが合致しているか確認する。
3. **文脈（履歴）を忘れる場合:**
   - Gemini側のセッションJSONファイルの中身（`messages` 配列）を直接開き、過去の会話ブロックが正しく上書きされているか確認する。
