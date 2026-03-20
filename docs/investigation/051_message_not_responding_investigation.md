# 調査レポート：051 メッセージが返ってこない不具合の調査

## Phase 1: 調査計画 (Investigation Planning)

### 現状の把握
- 現象：OpenClaw UI へのアクセスは可能だが、AIにメッセージを送信しても応答が返ってこない。
- 背景：コミット `d3ca3d35` および `f5d74b92` にて、`RunnerPool`（永続ランナー）の導入、IPCによる通信への移行、デバッグログの抑制などが行われた。
- 3月18日時点では正常に動作していた。

### 調査対象
1. `logs/adapter.log`: リクエストがアダプターに到達しているか、エラーが出ていないか。
2. `logs/adapter_last_req.json`: クライアントから送信された最新のリクエスト内容。
3. `src/server.js`: HTTPリクエストのハンドリング、SSEレスポンスの開始処理。
4. `src/streaming.js`: `RunnerPool` からランナーを取得し、IPCメッセージを受信して SSE を書き込む一連のフロー。
5. `src/runner-pool.js` & `src/runner.mjs`: ランナーの起動状態、IPCメッセージ（`run`, `ready`, `run_complete`）の送受信状態。

### 調査手順
1. **ログの確認**: `docker logs` および `logs/adapter.log` を監視し、メッセージ送信時に何が起きているかを確認する。
2. **IPCフローの精査**: `streaming.js` と `runner-pool.js` の間でメッセージが正しく受け渡されているか、コードリーディングで確認する。
3. **SSE終端処理の確認**: `run_complete` イベントが正しく処理され、`res.end()` が呼ばれているかを確認する。
4. **事実の収集とレポート更新**: 発見した事実を本ドキュメントに時系列で追記する。

### Phase 2: 調査・レポート作成 (Fact Finding & Reporting)

### 調査レポート：メッセージが返ってこない不具合 (ReferenceError)

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: リクエスト受信時にアダプター内部で例外が発生し、レスポンスが中断されているのではないか。
- **検証**: `logs/adapter.log` を `tail` で確認。
- **事実の発見**: 
    - ログに `ReferenceError: reqStart is not defined` が記録されていることを発見。
    - 発生箇所: `/app/src/server.js:349:92`
    - 原因：コミット `f5d74b92` における変更で、`const reqStart = Date.now();` の定義が削除されたにもかかわらず、その後の `debug` ログ出力で `reqStart` が参照され続けている（デバッグログ抑制のリファクタリング時のミス）。

【コードベース・仕様から確認された最終的な事実】
- `src/server.js` の L349: `debug(`[perf] Request processing before runGeminiStreaming took ${Date.now() - reqStart}ms`);`
- `src/server.js` 内に `reqStart` の定義なし（以前は L96 付近に存在したが `f5d74b92` で削除された）。
- サーバーは起動し、ポート 3972 で待機しているが、リクエストを受け取った瞬間にこの行で例外が投げられ、ハンドラが異常終了する。これにより SSE のヘッダー送信（`res.writeHead`）よりも前で処理が止まり、UIには何も返ってこない状態となる。

---
※ 本レポートは事実の列挙です。この結果に基づき、Phase 3 の実装計画作成へ進んでよいか、ご指示をお願いします。
