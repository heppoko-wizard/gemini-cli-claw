# 運用手順書（Runbook）

## 1. 通常運用

### 起動手順
Gemini CLI Adapter と OpenClaw Gateway の2つのプロセスを起動する必要があります。

```bash
# アダプタサーバーの起動 (Port: 3972)
cd /home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw
nohup ./start.sh > adapter.log 2>&1 &

# OpenClaw Gatewayの起動 (Port: 18789)
cd /home/heppo/ドキュメント/DEV/openclaw
nohup node openclaw.mjs gateway --port 18789 > openclaw-gateway.log 2>&1 &
```

### 停止手順
ポート番号を指定してプロセスをキルします。

```bash
kill $(lsof -t -i :3972) $(lsof -t -i :18789)
```

## 2. 障害対応

### 症状A: Telegram等から応答がない (Connection Refused)
- **確認すること**:
  1. `lsof -i :3972` または `lsof -i :18789` でプロセスが生きているか確認。
  2. `adapter.log` にエラー（例: `Gemini CLI failed to start`）が出ていないか確認。
- **対処**:
  1. プロセスが死んでいる場合は、停止手順で残骸を消してから起動手順をやり直す。

### 症状B: OpenClaw側で "Cannot read properties of undefined (reading '0')" エラーが出る
- **確認すること**:
  - `openclaw.json` のプロバイダ設定 (`api`) が `openai-completions` になっているか？
  - `adapter.js` の抽出ロジックが、SSE `chat.completion.chunk` 形式でキチンと `choices` 配列を吐き出しているか？
- **対処**:
  - 設定やレスポンスフォーマットの不整合を修正し、アダプタを再起動する。

### 症状C: AIが直前の会話やツールの結果を忘れる（記憶喪失 / コンテキスト無視）
- **確認すること**:
  1. `/tmp/adapter_last_req.json` にOpenClawからの直近の生リクエストが来ているか（ツールコール履歴が空になっていないか）。
  2. `adapter.log` の行末で `[inject] Successfully injected` というメッセージが出力されているか。
- **対処**:
  - `injectToolHistoryIntoOpenClaw` の処理が（JSONLのパースエラー等で）失敗している場合、`adapter.js` の正規表現による注入ロジックを見直す。

## 3. 定期運用・クリーンアップ
- （オプション）溜まったログファイル群 (`adapter.log`, `openclaw-gateway.log`, `~/.openclaw/agents/` 内の `.jsonl`, `~/.gemini/tmp/chats/` や一時的な `gemini-system-*.md`）の肥大化によるディスク圧迫の監視・削除。

## 4. 環境情報

| 項目 | 値 |
|------|------|
| Adapter ポート | 3972 |
| OpenClaw ポート | 18789 |
| アダプタログ | `/home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw/adapter.log` |
| Gatewayログ | `/home/heppo/ドキュメント/DEV/openclaw/openclaw-gateway.log` |
| 直近リクエスト | `/tmp/adapter_last_req.json` |

---

## 更新履歴
| 日付 | 変更内容 |
|------|----------|
| 2026-02-22 | 初版作成。デバッグの失敗を元に障害対応の指針を策定 |
