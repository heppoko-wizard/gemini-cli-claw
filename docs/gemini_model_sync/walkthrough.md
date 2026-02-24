# Gemini モデル動的同期機能 実装概要

## 1. 実施内容の概要
これまでの Gemini CLI アダプターでは、特定のモデル（`gemini` エイリアスなど）のみが利用可能でしたが、Gemini CLI コアがサポートする全てのモデル（Gemini 2.5/3 シリーズなど）を OpenClaw の UI から動的に選択し、切り替えて利用できるように統合しました。

## 2. 主な変更点

### モデルリストの動的取得と同期
- **新スクリプト**: `scripts/update_models.js`
  - `@google/gemini-cli-core` から有効なモデルリストを直接取得します。
  - 取得したリストを OpenClaw の本体設定ファイル (`~/.openclaw/openclaw.json`) に同期し、UI上で選択可能にします。
- **自動実行**: `start.sh` および `setup.js` を更新し、アダプターの起動前やインストール時に自動でモデルリストが更新される仕組みを構築しました。

### アダプター側のモデル伝搬
- **`server.js`**: `POST /responses` エンドポイントが `body.model` を受け取り、実行エンジンに渡すように拡張しました。
- **`runner.js`**: IPC経由で受け取ったモデル名を Gemini CLI の設定（`settings.merged.model.name`）に動的に反映するよう修正しました。

### 運用とデバッグの強化 (Logging)
- **`adapter.log`**: 各リクエストごとに、実際にどの Gemini モデルが選択され、実行されたかを以下の形式で記録するようにしました。
  - `[adapter] Selected model: gemini-2.5-flash`
  - `[Runner] Using model: gemini-2.5-flash`

## 3. 検証結果
- `openclaw models list` にて、`gemini-2.5-flash`, `gemini-3.1-pro-preview` 等、全9モデルが「configured」として表示されることを確認。
- UIでモデルを「gemini-2.5-flash」に切り替えた際、`adapter.log` にそのモデル名が出力され、応答が正常に返ってくることを確認。

---
> [!NOTE]
> 初期設定では `auto-gemini-3` がデフォルトとして選択されますが、OpenClaw の設定で任意に変更可能です。
