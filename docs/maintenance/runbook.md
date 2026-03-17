# 運用手順書（Runbook）

> [!CAUTION]
> **【警告】保守・修正時の注意点**
> 以下のドキュメントには、プロジェクト初期のパスやエラーが歴史としてそのまま記載されています。本システムには、ストリームに意図的に見えない文字を混入させるハック（ZWCステガノグラフィ）等が含まれています。コードを修正する際は、**必ず最初に `AI_CRITICAL_CONTEXT.md` を熟読してください。** 知識ゼロでのコードの「クリーンアップ（古い記述の削除等）」はシステムコンテキストを破壊します。

## 1. 通常運用

### 起動手順

起動には2つの方法があります。基本的には一括起動が推奨されます。

#### A. 一括起動 (推奨)
Gemini CLI Adapter と OpenClaw Gateway、そしてコントロールダッシュボードを全て自動で起動します。

```bash
cd "$(npm root -g)/openclaw/openclaw-gemini-cli-adapter"
# Windows の場合は コマンドプロンプト等で該当ディレクトリへ移動して launch.bat を実行
./launch.sh
```

#### B. 個別起動 (手動運用時)
ログをターミナルで直接確認したい場合などに使用します。

```bash
# ターミナル1: アダプタサーバーの起動 (Port: 3972)
cd "$(npm root -g)/openclaw/openclaw-gemini-cli-adapter"
./start.sh

# ターミナル2: OpenClaw Gatewayの起動 (Port: 18789)
openclaw -- gateway
```

### 停止手順

専用の停止スクリプトを使用して、関連する全てのプロセス（Adapter, Gateway, コントロールダッシュボード, Gemini Runner）を一括で安全に終了します。

```bash
cd "$(npm root -g)/openclaw/openclaw-gemini-cli-adapter"
# Windows の場合は stop.bat を実行
./stop.sh
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
- **対処 (最新 SSoT 3.1仕様)**:
  - 履歴自体が空であれば、旧バージョンのようにFUSEマウント切れ等の可能性もありますが、現在は**ZWC（ゼロ幅文字）を用いたメタデータ通信が文字数制限等でクリップされた、あるいはUI側でサニタイズされた**可能性が高いです。サーバー側（OpenClaw Gateway保存）の履歴を再送信するよう設定を見直す必要があります。
  - ZWCのデコード処理が何らかの原因で失敗していないかログを確認します。

### 症状D: ツール（shell等）が "Permission Denied" または機能しない
- **確認すること**:
  - `gemini-home/.gemini/settings.json` の `tools.sandbox` が `false` になっているか。
  - `context.includeDirectories` に操作対象のパスが含まれているか。
- **対処**:
  - `interactive-setup.js` を再実行するか、手動で `settings.json` を修正してサンドボックスを解除する。

## 3. 定期運用・クリーンアップ
- （オプション）溜まったログファイル群 (`logs/adapter.log`, OpenClawのGatewayログ, `/home/{username}/.openclaw/agents/` 内の `.jsonl`, `gemini-home/.gemini/tmp/` 以下のファイル群）の肥大化によるディスク圧迫の監視・削除。

## 4. 環境情報

※ `[AdapterDir]` は、npmグローバルパスや現在のワークスペース（`/home/heppo/DEV/`など）を指します。古いログは当時の `/home/heppo/` で記録されています。

| 項目 | 値 |
|------|------|
| Adapter ポート | 3972 |
| OpenClaw ポート | 18789 |
| アダプタログ | `[AdapterDir]/logs/adapter.log` |
| Gatewayログ | `/home/{username}/.openclaw/logs/` 配下等の標準ログ出力先 |
| 直近リクエスト | `[AdapterDir]/logs/adapter_last_req.json` |

---

## 更新履歴
| 日付 | 変更内容 |
|------|----------|
| 2026-02-22 | 初版作成。デバッグの失敗を元に障害対応の指針を策定 |
| 2026-02-24 | ログ集約（`logs/`配下）およびRunnerPool化に伴うJSONL注入ハックの削除を反映 |
| 2026-03-02 | 権限不足（サンドボックス制限）に関するトラブルシューティングを追記 |
| 2026-03-10 | OpenClawのバイナリインストール版移行に伴うパス（`/home/{username}/` や `npm root -g`）の修正 |
