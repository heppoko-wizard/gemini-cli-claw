日本語で記述する/とりあえず実装禁止/推測の事実確認調査必須/１次情報へのアクセス義務/調査手順はwebで最善手→公式docsおよびcode baseで裏どり/調査報告書類は追記のみ要約圧縮削除禁止/徹底します。

# 修正計画パターン B：コア環境変数保護（ブラックリスト）パターン (Immutable Env Protection)

## 1. 概要
`server.js` から環境変数全体（`...process.env`）が送られてくる現状の仕様を許容しつつ、受信側である `runner.mjs` にて「隔離環境の維持に絶対に必要な環境変数（聖域）」をブラックリスト化し、上書きをブロックする防衛的なアプローチです。

## 2. 背景と解決するメカニズム
親プロセス（Gateway）の環境変数をランナーに全転送する現在の仕様は、ユーザーが Gateway を起動した際の環境（例えば一時的な `HTTP_PROXY` や各種トークンなど）をそのまま AI の実行環境に反映できるという副次的なメリットを持っています。
しかし、`GEMINI_CLI_HOME` のような「アダプターが隔離アーキテクチャのために意図的に注入したもの」まで上書きしてしまうのが問題です。

## 3. 実装の方向性
- **`src/runner.mjs` の改修**:
  環境変数を統合する処理において、保護すべきキーリストを定義し、それ以外のみを適用します。
  ```javascript
  // 修正箇所 (src/runner.mjs)
  if (env) {
      const protectedKeys = ['GEMINI_CLI_HOME', 'XDG_CONFIG_HOME', 'GOG_KEYRING_BACKEND', 'GOG_KEYRING_PASSWORD'];
      for (const [key, value] of Object.entries(env)) {
          if (!protectedKeys.includes(key)) {
              process.env[key] = value;
          }
      }
      console.error(`[Runner:perf] Env propagation (with protection) took ${Date.now() - runnerPerfStart}ms`);
  }
  ```

## 4. 評価
- **メリット**:
  - `server.js` の実装を変更せず、ランナー側の防波堤のみで問題を解決できます。
  - 親プロセス由来の動的な環境変数の恩恵（プロキシ設定など）を失わずに済みます。
- **デメリット**:
  - 「どの変数が保護されるべきか」という知識を `runner.mjs` がハードコードで持つことになり、今後 `runner-pool.js` で新しい隔離用変数を追加した際、こちらにも追記を忘れると再びバグが生じます（知識の分散）。