日本語で記述する/とりあえず実装禁止/推測の事実確認調査必須/１次情報へのアクセス義務/調査手順はwebで最善手→公式docsおよびcode baseで裏どり/調査報告書類は追記のみ要約圧縮削除禁止/徹底します。

# 修正計画パターン A：差分注入（ホワイトリスト）パターン (Delta Env Injection)

## 1. 概要
`server.js` からランナーへ IPC 通信で環境変数を渡す際、ホストプロセスの環境変数全体（`...process.env`）を送るのをやめ、今回のリクエスト処理に真に必要な「差分のみ」を明示的に送信・適用する最もスマートなアプローチです。

## 2. 背景と解決するメカニズム
現在のアーキテクチャでは、`runner-pool.js` が `spawn` を実行する時点で、隔離環境としての正しい `GEMINI_CLI_HOME` や `XDG_CONFIG_HOME` は既に OS レベルで子プロセスに正しく継承されています。
それにもかかわらず、`server.js` がリクエストの度に自らの `process.env`（ホスト側のデフォルトパスなどを含む）を丸ごと IPC で送り、ランナーがそれを `Object.assign` で全上書きしているため、事前ウォームアップで築き上げた環境が破壊されています。

## 3. 実装の方向性
- **`src/server.js` の改修**:
  環境変数を生成する際、`...process.env` の展開を廃止します。
  ```javascript
  // 修正前
  const env = {
      ...process.env,
      OPENCLAW_SESSION_KEY: sessionKey,
      GEMINI_SYSTEM_MD: tempSystemMdPath,
  };

  // 修正後
  const envOverrides = {
      OPENCLAW_SESSION_KEY: sessionKey,
      GEMINI_SYSTEM_MD: tempSystemMdPath,
  };
  ```

- **`src/runner.mjs` の改修**:
  送られてきた `env`（実質的には `envOverrides`）のみを適用するため、隔離環境の変数はそのまま維持されます。コードの変更は最小限で済みます。

## 4. 評価
- **メリット**:
  - 不要なデータ転送がなくなり、ロジックがシンプルかつ透過的になります。
  - `runner-pool.js` で設定した隔離環境変数が絶対に侵されなくなります。
  - 修正箇所が少なく、エンバグのリスクが最も低い現実的な最適解です。
- **デメリット**:
  - もし将来、OpenClaw（Gateway）側で一時的に追加された環境変数（新しいAPIキーなど）をランナーに引き継ぎたくなった場合、手動でホワイトリストに追加する手間が発生します。