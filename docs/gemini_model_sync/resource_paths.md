# Gemini CLI Adapter 関連パス一覧

Gemini CLI アダプター（`gemini-cli-claw`）の運用、デバッグ、設定に必要なファイルパスのまとめです。

## 1. アダプター本体 (gemini-cli-claw)

| 種類 | パス | 説明 |
| :--- | :--- | :--- |
| **作業ディレクトリ** | `/home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw` | アダプターのソースコードと実行スクリプトの場所。 |
| **ログファイル** | `logs/adapter.log` | アダプターの動作ログ。選択されたモデル名や通信状況が記録されます。 |
| **起動スクリプト** | `start.sh` | アダプターサーバーをバックグラウンドで起動するスクリプト。 |
| **同期スクリプト** | `scripts/update_models.js` | Gemini CLIからモデル一覧を取得し、OpenClawの設定を更新する。 |

## 2. OpenClaw 設定ファイル

| 種類 | パス | 説明 |
| :--- | :--- | :--- |
| **本体設定** | `~/.openclaw/openclaw.json` | **最優先設定ファイル。** プロバイダー設定、UIに表示するモデル一覧、デフォルトモデルが含まれます。 |
| **実行用モデル設定** | `~/.openclaw/agents/main/agent/models.json` | OpenClaw Gatewayが実行時に参照するモデル定義。`openclaw.json` から自動生成されます。 |

## 3. 会話履歴・セッション管理

| 種類 | パス | 説明 |
| :--- | :--- | :--- |
| **セッションマップ** | `~/.openclaw/gemini-session-map.json` | OpenClawのセッションIDとGemini CLI内部のUUIDの紐付け。 |
| **Gemini会話履歴** | `~/.openclaw/gemini-sessions/<session_key>/.gemini/tmp/gemini-cli-claw/chats/session-*.json` | Gemini CLI側で保持されている、モデルとのやり取りの生データ（JSON）。 |

## 4. その他関連ログ・一時ファイル

| 種類 | パス | 説明 |
| :--- | :--- | :--- |
| **Gatewayログ** | `/home/heppo/ドキュメント/DEV/openclaw/openclaw-gateway.log` | OpenClaw全体の通信ログ（Telegramの受信状況など）。 |
| **リクエストキャッシュ** | `logs/adapter_last_req.json` | アダプターが最後に受け取ったHTTPリクエストの生データ。デバッグ用。 |

---
> [!TIP]
> アダプターのログ (`logs/adapter.log`) を確認することで、`Selected model:` という行から、実際にどのモデルがリクエストで使用されたかを特定できます。
