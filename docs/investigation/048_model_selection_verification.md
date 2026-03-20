### 調査レポート：モデル選択の検証

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: OpenClaw (Open WebUI) で選択されたモデルが adapter 内部で無視され、常にデフォルトモデルが使用されているのではないか。
- **検証**: 
    1. `src/server.js` におけるリクエストボディのパース処理を確認。
    2. `src/streaming.js` から `src/runner-pool.js` へのパラメータ受け渡しを確認。
    3. `src/runner.mjs` における `gemini-cli` コアへのモデル設定の適用を確認。
    4. `logs/adapter.log` および `logs/adapter_last_req.json` を閲覧し、実際の動作を確認。
- **事実の発見**: 
    - `src/server.js` は正常に `body.model` を抽出し、`reqModel` 変数に格納している。
    - `logs/adapter_last_req.json` にて、クライアントから `"model": "gemini-2.5-flash"` が送信されていることを確認。
    - `logs/adapter.log` にて、`[Runner] Using model: gemini-2.5-flash` とログ出力されており、実際に指定されたモデルが `runner.mjs` で適用されていることを確認。
    - **不信感の原因の特定**: `src/streaming.js` の `sseWrite` 呼び出し箇所（計10箇所以上）において、SSE 返却用のメタデータ `model` が `'gemini'` という文字列にハードコードされている。これにより、クライアントUI上では常に「gemini」というモデルが回答しているように見えている。

【コードベース・仕様から確認された最終的な事実】
- `src/server.js` L257-261: `body.model` を取得し、未指定時は `auto-gemini-3` をデフォルトとしている。
- `src/runner.mjs` L160-166: 受信した `model` パラメータを `settings.merged.model.name` および `config.settings.model.name` に正しく代入している。
- `src/streaming.js` L87, L240, L266, L285, L316, L346, L361, L377, L427, L444, L461: 全てのレスポンスチャンクで `model: 'gemini'` がハードコードされている。

---
※ 本レポートは事実の列挙です。この結果に基づき、Phase 3 の実装計画作成（ハードコードの修正）へ進んでよいか、ご指示をお願いします。
