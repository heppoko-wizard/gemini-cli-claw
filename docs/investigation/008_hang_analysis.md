# 調査報告：システムハング（メッセージが返ってこない問題）の解析

## 概要
ユーザーより、メッセージ送信後に「考え中」のまま応答が返ってこない（ハングする）現象が再発したとの報告を受け、調査を実施しました。

## 調査結果

### 1. ログの解析 (`adapter.log`)
`/usr/lib/node_modules/openclaw/openclaw-gemini-cli-adapter/logs/adapter.log` を確認したところ、以下の致命的なエラーが記録されていました。

```
[Pool] Spawning a new warm standby runner (Node.js)...
[Pool] Runner process error: Error: spawn node ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:285:19)
    ...
[adapter] [adapter] Acquiring runner for sessionKey: default
[Pool] No runners ready. Queuing request...
```

### 2. 原因の特定
*   **エラー内容**: `spawn node ENOENT`
*   **発生箇所**: `src/runner-pool.js` 内の `spawn('node', ...)` 呼び出し。
*   **メカニズム**:
    1.  アダプタ起動時に `RunnerPool` がウォームスタンバイの `runner.mjs` プロセスを起動しようとする。
    2.  `spawn('node', ...)` を実行する際、現在の実行環境（パス）から `node` コマンドが見つからず、`ENOENT` エラーで失敗する。
    3.  待機プロセス（Runner）が1つも生成されない状態になる。
    4.  リクエストが届くと、`RunnerPool` は「利用可能なRunnerがない」と判断し、リクエストをキュー（`pendingRequests`）に入れて待機プロセスがReadyになるのを永遠に待ち続ける。
    5.  結果として、メッセージが「考え中」のまま進まなくなる。

### 3. なぜ `node` が見つからないのか（以前は動いていた理由）
*   **以前の修正（問題8）が「脆弱」だった**:
    前回は `process.execPath` が `openclaw` バイナリを指してしまう問題を回避するため、単純な `'node'` コマンドに書き換えました。この時点では「ユーザーがターミナルから直接手動で起動していた」ため、シェルの `PATH` に Node.js が含まれており、運良く動作していました。
*   **現在の状況（グローバルインストール環境）**:
    現在は `/usr/bin/openclaw`（シンボリックリンク）等の「グローバルな実行コンテキスト」で起動されています。この場合、プロセスの `PATH` に `/usr/bin` や NVM のパスが含まれないことがあり、単なる文字列としての `'node'` ではバイナリを特定できず `ENOENT` となりました。
*   **PC の故障ではありません**: `node` 自体は `/usr/bin/node` に存在することを確認済みです。純粋にアダプタ側の「バイナリ特定の精度」が不足していたことが原因です。

## 結論：修正と検証の完了
2026-03-10 に実施した修正により、以下の改善を確認しました。

1.  **堅牢な解決**: `runner-pool.js` が `process.execPath`、`which node`、および複数の絶対パスを組み合わせて Node.js バイナリを特定するようになりました。
2.  **パスの正規化**: すべての解決されたパス（CWD、バイナリパス）に対して `.trim()` を適用し、不可視文字（`\r` 等）による実行失敗を防止しました。
3.  **動作確認**: `start.sh` による起動後、ログに `[Pool] Runner is ready to accept requests.` が出力され、正常にポート 3972 で待機していることを確認しました。

本件による PC 環境への悪影響はありません。アダプタ内部のパス処理の不備が原因であり、今回の修正で恒久的に対策されました。
