# 運用手順書（Runbook）

## 1. 通常運用

### 起動手順
Gemini CLI Adapter と OpenClaw Gateway の2つのプロセスを起動する必要があります。

```bash
# アダプタサーバーの起動 (Port: 3972)
cd /home/heppo/ドキュメント/DEV/openclaw/openclaw-gemini-cli-adapter
nohup ./start.sh > logs/adapter-nohup.log 2>&1 &

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
  2. `logs/adapter.log` にエラー（例: `Runner Pool Initialization Failed`）が出ていないか確認。
- **対処**:
  1. プロセスが死んでいる場合は、停止手順で残骸を消してから起動手順をやり直す。

### 症状B: OpenClaw側で "Cannot read properties of undefined (reading '0')" エラーが出る
- **確認すること**:
  - `openclaw.json` のプロバイダ設定 (`api`) が `openai-completions` になっているか？
- **対処**:
  - 設定の不整合を修正し、Gatewayとアダプタを再起動する。

### 症状C: AIが直前の会話やツールの結果を忘れる（記憶喪失 / コンテキスト無視）
- **確認すること**:
  - `logs/adapter_last_req.json` にOpenClawからの直近の生リクエストが来ているか（`messages` 配列にツールコール履歴が含まれているか）。
- **対処**:
  - リクエスト（履歴）自体が空であれば、OpenClaw側のセッション管理（FUSEマウント切れ等）を疑う。Gatewayの再起動や `sudo umount -l` を試す。

## 3. 定期運用・クリーンアップ
- （オプション）溜まったログファイル群 (`logs/adapter.log`, `openclaw-gateway.log`, `~/.openclaw/agents/` 内の `.jsonl`, `~/.gemini/tmp/chats/` 以下のファイル群）の肥大化によるディスク圧迫の監視・削除。

## 4. 環境情報

| 項目 | 値 |
|------|------|
| Adapter ポート | 3972 |
| OpenClaw ポート | 18789 |
| アダプタログ | `/home/heppo/ドキュメント/DEV/openclaw/openclaw-gemini-cli-adapter/logs/adapter.log` |
| Gatewayログ | `/home/heppo/ドキュメント/DEV/openclaw/openclaw-gateway.log` |
| 直近リクエスト | `/home/heppo/ドキュメント/DEV/openclaw/openclaw-gemini-cli-adapter/logs/adapter_last_req.json` |

---

## 更新履歴
| 日付 | 変更内容 |
|------|----------|
| 2026-02-22 | 初版作成。デバッグの失敗を元に障害対応の指針を策定 |
| 2026-02-24 | ログ集約（`logs/`配下）およびRunnerPool化に伴うJSONL注入ハックの削除を反映 |
