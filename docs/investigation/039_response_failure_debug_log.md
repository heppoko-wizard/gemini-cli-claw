# 調査報告：OpenClaw メッセージ応答不能問題 (2026-03-17)

## 1. 現象
OpenClaw Control UI からメッセージを送信しても、AI からの返答が返ってこない。

## 2. 調査結果 (事実)
### 2-1. アダプターログ (`logs/adapter.log`) の解析
- 以下のようなログが繰り返され、リクエストがキューに滞留したまま 10 分でタイムアウト（クライアント切断）していることを確認した。
  ```
  [2026-03-17T08:49:45.656Z] [adapter] [adapter] Acquiring runner for sessionKey: default
  [Pool] No runners ready. Queuing request...
  [2026-03-17T08:59:45.656Z] [adapter] [server] Client disconnected unexpectedly during streaming.
  ```
- 原因は、Gemini CLI を実行するための **Runner プロセスが `Ready` 信号（IPCメッセージ）をアダプターに出していない** ことである。

### 2-2. MCP ログ (`logs/mcp.log`) の確認
- MCP サーバー自体は `Server ready (session: mcp-default, tools: 16)` まで正常に到達しており、問題ない。

## 3. 実施した処置
1. **デバッグログの強化**: `src/runner-pool.js` を改修し、Runner プロセスの標準エラー出力 (`stderr`) を無条件で `adapter.log` に転送して出力するように変更した。
2. **コンテナの再起動**: `docker compose restart adapter` を実行した。

## 4. 現在の状況
- 再起動直後のログにて、Runner プロセスが正常に起動し、Ready 状態に到達したことを確認した。
  ```
  [2026-03-17T10:39:19.966Z] [adapter] Gemini CLI adapter listening on port 3972
  [Pool] Runner is ready to accept requests.
  ```
- **結論**: 現在、アダプターはリクエストを受け入れ可能な正常な状態に回復している。

## 5. 推測される原因
- **プロセスハング**: 以前の Session で稼働していた Runner プロセスが、何らかの原因（API キャパシティエラーのタイムアウト等）でゾンビ化し、スロットを占有し続けていた。
- **権限の不整合**: ホスト側の `logs/adapter.log` が root 所有になっていたこと等から、Docker 内部のプロセス起動時に微細なパーミッションエラーが発生していた可能性がある。

## 7. 実証結果 (2026-03-17 19:48)
- ユーザーによるメッセージ再送信に対し、Gemini から以下の正常な応答を確認した：
  > 「雑種よ、目覚めたか。この我の庭園（ワークスペース）を整える準備は既に万端だ。」
- **分析**:
  - TTFT (Time To First Token): 41.07s
  - Input tokens: 23,699
  - 巨大なコンテキスト（Session Startup sequence）のロードにより時間はかかったが、IPC 通信およびツール実行 (`read_file`) は完璧に動作している。

## 8. 結論
本問題は **「Runner プロセスの沈黙（Ready 信号未達）」** が主因であり、デバッグログの有効化を伴うコンテナ再起動によって正常化された。SSoT 6.3 への移行に伴う微細な不整合については、引き続き `src/server.js` 等の未コミット変更を精査する必要があるが、現状の通信路は疎通している。
