# 調査結果と動的モデルリストの実装計画

ユーザー様からのご指摘通り、Gemini CLIの内部コードから動的にモデルリストを取得するアプローチへ計画を変更しました。

## 1. 調査結果まとめ（モデルリストの動的取得について）

Gemini CLIのコア・ロジック（`@google/gemini-cli-core`）を調査した結果、`VALID_GEMINI_MODELS` という `Set` オブジェクトがエクスポートされており、ここに利用可能な正確なモデル名（`gemini-3-pro-preview`, `gemini-2.5-flash` など）が全て含まれていることが確認できました。

OpenClaw自体のアーキテクチャとして、UIにモデル一覧を表示するには `~/.openclaw/agents/main/agent/models.json` への登録が必須となります。したがって、「Gemini CLIコアからモデルリストを動的に取得し、それを `models.json` に同期させる」スクリプトを作ることが最適解となります。

## 2. 実装計画 (Proposed Changes)

### 変更点1: モデルリスト動的同期スクリプトの作成
Gemini CLIのコアパッケージからモデルのリスト（`VALID_GEMINI_MODELS` 等）をロードし、OpenClawの `models.json` を動的に更新（追加・上書き）するJSスクリプトを作成します。

#### [NEW] `gemini-cli-claw/scripts/update_models.js`
*   `require('@google/gemini-cli-core')` でコアモジュールを読み込み。
*   `VALID_GEMINI_MODELS` （または `resolveModel` 等のメタデータ）からモデル配列を生成。
*   `~/.openclaw/agents/main/agent/models.json` をロードして、`gemini-adapter` のエントリを書き換え＆保存。

#### [MODIFY] `gemini-cli-claw/setup.js`
*   セットアップのフローの中で、上記で作成した `update_models.js` を実行し、インストール直後に自動で最新のリストが反映されるようにします。

### 変更点2: `gemini-cli-claw/src/server.js` のモデルエンドポイントとリクエスト処理
`/v1/models` エンドポイントでも動的に取得したモデルリストを返すようにし、さらに推論時に受け取ったモデル名を素直にGeminiへ流すようにします。

#### [MODIFY] `gemini-cli-claw/src/server.js`
*   `/v1/models` エンドポイントが呼び出された際、コアパッケージから取得した `VALID_GEMINI_MODELS` リストに基づいてJSONレスポンスを動的生成するように変更します。
*   現在のハードコードによる書き換え（例: `reqModel = reqModel === 'auto' ? 'auto-gemini-3' : reqModel` 等の分岐）を削除し、OpenClaw側のUI（`req.body.model`）で選ばれた文字列をそのままプロキシするようにします。

#### [MODIFY] `gemini-cli-claw/src/runner.js`
*   IPCメッセージ（`run`）を受け取った際、適用された `model` 名をログに出力するように追加します。

---

## 3. 検証計画 (Verification Plan)

### Manual Verification
1. `gemini-cli-claw` ディレクトリにて追加したモデル同期スクリプト（または `setup.js`）を実行します。
2. `~/.openclaw/agents/main/agent/models.json` に、Gemini CLIの最新バージョンによるサポートモデル一覧（Gemini 3シリーズなど）が正しく書き込まれたか確認します。
3. OpenClaw Gateway と Adapter (`npm run dev:adapter`) を起動します。
4. UI上で「gemini-3-pro-preview」等、取得した新モデルが選べるか確認。
5. 当該モデルを選んでプロンプトを送信し、`adapter.log` にて指定したモデルがGemini CLIに渡され、正常にストリーミング応答が返ってくるかを確認します。

---
この新しいプラン（Gemini CLI Coreから自動取得）で実装を進めてよろしいでしょうか？
