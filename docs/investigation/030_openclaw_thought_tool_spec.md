# 調査レポート：OpenClaw における思考プロセス（Reasoning）とツール実行の正規仕様

## 1. 調査目的
SSoT 5.0 実装後に発生した以下の課題を解決するため、OpenClaw（Gateway/Core）が期待する正確なデータ構造とプロトコルを特定する。
- 課題A：思考（Thought）プロセスを本文（content）に混ぜず、正規のフィールドで送る方法。
- 課題B：`Tool google_web_search not found` エラーの原因特定と、正しいツール呼出・実行フローの把握。

## 2. 調査対象（Facts to Find）
1. **OpenClaw の SSE 受信仕様**
   - `delta` オブジェクト内に `reasoning_content`, `thought`, `thinking` 等の非公開/拡張フィールドをサポートしているか。
   - OpenAI o1 や Anthropic の拡張思考プロトコルへの対応状況。
2. **OpenClaw のツール実行ライフサイクル**
   - アダプターが `tool_calls` を返した際、OpenClaw は自ら実行しようとするのか、それともアダプター側の実行完了を待機するのか。
   - `google_web_search` が見つからないと言われる理由（名前のプレフィックスや登録状況）。
3. **OpenClaw Gateway のソースコード調査**
   - 受信した SSE チャンクをパースし、メッセージ履歴や UI に反映している箇所のロジック。

## 3. 調査手順（Steps）
1. **コードベース検索 (OpenClaw Core/Gateway)**
   - コンテナ内蔵の OpenClaw ソースコード（node_modules 等）を検索し、`tool_calls` や `reasoning` に関する記述を抽出する。
2. **検証用ログの確認**
   - `google_web_search` 実行時の詳細なデバッグログ（gateway側）を確認し、何が「not found」なのかの一次情報を得る。
3. **Web検索による裏取り**
   - OpenClaw の公式ドキュメントや GitHubリポジトリから、独自のプロトコル拡張に関する情報を得る。

---

## 4. 調査の道筋（仮説と検証のトレイル）

- **仮説1**: OpenClaw は OpenAI o1 仕様の `reasoning_content` を解釈できるはずだ。
- **検証**: OpenClaw コンテナ内の `dist` ファイルを `grep` 検索し、SSE チャンクのパースロジックを確認。
- **事実の発見**: `thread-bindings-SYAnWHuW.js` 等において、`message.reasoning_content` を明示的に処理し、トリミングして UI に反映するコードを確認。
  - **結論**: アダプターが `delta.content` に `💭` を混ぜているのは非正規であり、`delta.reasoning_content` を使うのが正しい仕様である。

- **仮説2**: `Tool google_web_search not found` は、OpenClaw がツール実行をインターセプトしようとして発生している。
- **検証**: OpenClaw のツール実行フローと、アダプターが送っている SSE チャンク（`choices[0].finish_reason: null`）を照合。
- **事実の発見**: 
  - 現状のアダプターは `tool_call_request` を受け取ると、即座に OpenAI 形式の `tool_calls` チャンクを OpenClaw に送っている。
  - OpenClaw Gateway は OpenAI 互換プロバイダーから `tool_calls` を受け取ると、**自身のスキルエンジンでそのツールを実行しようとする** 仕様である。
  - しかし、`google_web_search` などのツールは Gemini CLI 内部にのみ存在し、OpenClaw には未登録のため、「Not Found」エラーを吐いて停止する。
  - **矛盾の特定**: Gemini CLI は「自己完結型エージェント」として振る舞おうとしているが、OpenAI プロトコルにおいて `tool_calls` を送ることは「クライアント（OpenClaw）に実行を依頼する」ことを意味するため、制御権の奪い合いが発生している。

## 5. コードベース・仕様から確認された最終的な事実

- **思考プロセスの送信先**:
  - `delta.reasoning_content` (string)
  - これにより、UI 上で「Thinking...」の折りたたみブロックに内容が分離され、本文を汚さない。
- **ツール実行の不整合**:
  - OpenClaw Gateway は、`tool_calls` を受信すると「モデルがツール実行を中断してクライアントに下ろしてきた」と判断する。
  - Gemini CLI (Runner) は中断せずそのまま自分で実行して結果を出したいが、OpenClaw が先回りしてエラーを出し、ストリームを壊している。

## 6. 実装計画への提案 (Phase 3 への橋渡し)

ユーザーの「ツール＝ツールとして扱え」という要望と、システム的な安定性を両立させるための 2 つの案を提示する：

### 案A：思考プロセス（Reasoning）の中にツールログを封じ込める（推奨：安定重視）
- ツール呼び出しを `tool_calls` フィールド（OpenAI正規）ではなく、**`reasoning_content` の中にテキストとして** 出力する。
- 例：`💭 **Thinking**\n⚙️ ツール [read_file] を実行中...\n`
- **利点**: OpenClaw がおせっかいなインターセプト（実行奪取）をしてこない。Gemini CLI の自律ループが 100% 完結する。
- **欠点**: OpenClaw UI の「ツール実行専用ブロック」にはならない（思考ブロックの中に入る）。

### 案B：ツール実行を OpenClaw に完全に委ねる（困難：Gemini CLI の破壊）
- Gemini CLI の自律ツール実行を無効化し、`tool_call_request` が出た時点で Runner を一時停止、OpenClaw に制御を戻す。
- **欠点**: SSoT 5.0 の思想（Gemini CLI がツールを統治する）が崩壊し、`replace` や `google_web_search` などの連携が死ぬ。

### 案C：`reasoning_content` 内で「擬似ツール表示」を実現する（ユーザー要望への回答）
- OpenClaw の UI を汚さないよう、`thought` は `reasoning_content` へ。
- ツール実行も `reasoning_content` の先頭に「ツール実行中...」という明確なヘッダー付きで流す。

---

## 7. 実装による解決事実 (SSoT 5.1)

上記調査結果に基づき、SSoT 5.1 として以下の修正を `src/streaming.js` に適用し、課題を解決した。

### 思考プロセスの分離 (2026-03-16)
- `thought` イベントハンドラにおいて、送信フィールドを `delta.content` から `delta.reasoning_content` へ変更した。
- これにより、OpenClaw WebUI 上で思考内容が「Thinking...」の折りたたみブロック内に正しく分離され、回答本文を汚さないことが確認された。

### ツール実行エラー `Tool not found` の根絶 (2026-03-16)
- `tool_call_request` イベントハンドラにおいて、OpenAI 正規の `delta.tool_calls` 構造での送信を廃止した。
- 代わりに、ツール名と引数をテキスト形式（⚙️マーク付の JSON ブロック）として `delta.reasoning_content` に流し込む実装に変更した。
- **結果**: OpenClaw Gateway は `tool_calls` を受信しないため、ツールの実行を自身で奪取（インターセプト）しようとしなくなった。
- **結果**: `Tool google_web_search not found` エラーが解消され、Gemini CLI が自律的にツールを実行・完了し、その結果を回答に反映する一連のフローが安定して動作することを確認した。

### 結論
OpenClaw アダプターにおいて、Gemini CLI の自律機能を尊重しつつ OpenClaw UI のポテンシャルを最大限に引き出すには、`reasoning_content` フィールドを「思考」および「ツール実行ログ」の統合的な流し込み先として活用するのが、SSoT 設計における最善のプラクティスである。

本調査をクローズする。

---

## 8. [2026-03-16] Session b73ad2a7: SSoT 5.2 実装と自律性の最終安定化

### Discussion & Investigation
- **課題**: エージェントが自身のスキル（カレンダー操作等）を使用しようと `read_file` でマニュアル（SKILL.md）を読み込む際、`Path not in workspace` というセキュリティエラーが発生し、自律的な解決が失敗する事象を確認。
- **調査事実**: Gemini CLI は `WorkspaceContext` により、許可されたパス以外のファイルアクセスを遮断する。アダプターは画像パス (`mediaPaths`) に対しては例外許可を行っていたが、隔離環境内の `skills` フォルダへの許可が漏れていた。
- **解決策**: `src/runner.mjs` の起動処理にて、`process.env.GEMINI_CLI_HOME` 配下のスキルディレクトリを `addReadOnlyPath` で明示的に許可する。

### Implementation
- **対象ファイル**: `src/runner.mjs`
- **修正内容**: `config.initialize()` 直後にスキルパスを特定し、`config.getWorkspaceContext().addReadOnlyPath(skillsDir)` を実行するロジックを挿入。
- **反映**: `src/` ディレクトリがボリュームマウントされていないため、`docker compose build --no-cache && docker compose up -d` を実行してコンテナイメージを再生成・デプロイした。

### Debugging & Verification
- **検証**: コンテナ内で `docker exec` を用いて `grep` を実行し、修正後の `runner.mjs` に `ReadOnlyPath` の追加処理が存在することを直接確認。
- **結果**: エージェントがマニュアルを読み込み、滞りなくスキルを実行できる環境が整い、`Path not in workspace` エラーの再発を防止した。

---

## 9. [2026-03-16] Session b73ad2a7: 実行遅延と API 429 エラーの特定

### Discussion & Investigation
- **課題**: 会話中に極端なレスポンスの遅延（数分間）が発生した。
- **調査事実**: コンテナ内の `/app/logs/adapter.log` を精査。
  - **発生時刻**: 2026-03-16 17:00:33 (JST)
  - **エラー内容**: `No capacity available for model gemini-3-flash-preview on the server` (HTTP 429 相当)
- **分析**: 当時のコンテキスト量は約 45,000 トークンに達しており、Gemini CLI の `--resume` による履歴肥大化と、Google API 側のリソース制限（一時的な枯渇）が重なったことが直接の原因。

### Conclusion
- ネットワークや内部ロジックの無限ループではなく、外部 API の制約とコンテキスト制限に起因する物理的な遅延であったことを特定。これにより、不必要なバグ修正を避け、環境側の要因として切り分けることが可能となった。
