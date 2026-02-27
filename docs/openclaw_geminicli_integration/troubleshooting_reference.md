# トラブルシューティング参照ファイル一覧 (Troubleshooting Reference)

OpenClaw ↔ Gemini CLI 連携において、「会話が通らない」「ツール履歴を忘れる」「接続が拒否される」などの不安定な挙動が発生した場合、以下のファイル群を順番に確認して原因を切り分けます。

## 1. ログファイル (Logs)
エラーの直接的な原因を探るための一次情報源です。

* **`/home/heppo/ドキュメント/DEV/openclaw/openclaw-gemini-cli-adapter/adapter.log`**
  * **役割**: アダプタサーバーの標準出力・エラー。
  * **確認ポイント**:
    * `Incoming request: POST /responses` が来ているか（OpenClawからリクエストが届いているか）
    * `Gemini CLI process closed with code X` の終了コードは何か (0以外なら異常終了)
    * `[inject] Successfully injected` が出ているか（ツール履歴の保存に成功したか）

* **`/home/heppo/ドキュメント/DEV/openclaw/openclaw-gateway.log`**
  * **役割**: OpenClaw Gateway本体のログ。
  * **確認ポイント**:
    * Gateway自体がクラッシュ・ストールしていないか
    * Telegram等からのメッセージ受信(Webhook)が正常に行われているか

## 2. 通信ペイロード (Payloads)
「何が送られ、何が返ってきているか」のデータ構造のズレを確認します。

* **`/tmp/adapter_last_req.json`**
  * **役割**: OpenClawからアダプタに最後に送信されたリクエストの生JSON。
  * **確認ポイント**:
    * `messages` 配列の中に、過去のツール実行結果（`role: "tool"` 等）が含まれているか（記憶喪失の確認）

* **`~/.openclaw/gemini-sessions/<Session_Key>/.gemini/tmp/openclaw-gemini-cli-adapter/chats/<UUID>.json`**
  * **役割**: Gemini CLIが内部で保持している会話履歴。
  * **確認ポイント**: Adapterがこのファイルに正常に `history` を上書きできているか。

## 3. 設定・マッピングファイル (Configs & Maps)
セッションの紐付けや接続先の設定が正しいか確認します。

* **`~/.openclaw/gemini-session-map.json`**
  * **役割**: OpenClawのセッションキー（ユーザー/チャット単位）とGemini CLIのUUIDの対応表。
  * **確認ポイント**: マッピングが壊れていないか、意図しないUUIDに切り替わっていないか。

* **`~/.openclaw/agents/main/sessions/<Session_Key>.jsonl`**
  * **役割**: OpenClaw側が保持している履歴ファイル。
  * **確認ポイント**: `injectToolHistoryIntoOpenClaw` 関数によって、Assistantの返答ブロック内に `toolCalls` と `toolResults` が正しくパース可能なJSONとして埋め込まれているか。（フォーマットが壊れると次回のパースで死ぬ）

* **`~/.openclaw/openclaw.json`**
  * **役割**: メイン設定。
  * **確認ポイント**: `gemini-adapter` のプロバイダ `api` 指定が `openai-completions` になっているか。

---

## 基本的なデバッグフロー
1. 会話が失敗した直後に `tail -n 100 adapter.log` を確認する。
2. もし `[inject] RegExp match failed` 等が出ていれば、直近の `.jsonl` ファイルを開いてJSON構造の破損を確認する。
3. もし `adapter.log` に一切リクエストが来ていなければ `openclaw-gateway.log` を見る（Gateway側の問題）。
