# 2026-02-13 開発ログ

## セッション 1

### やったこと
- OpenClawのGemini CLI統合の初期調査を開始。
- OpenClawのアーキテクチャ（特にLLM呼び出し経路）の分析（`runCliAgent` や `runEmbeddedPiAgent` の調査）。
- Gemini CLIが `-o stream-json` をサポートしているかどうかの確認。

### 発見・学んだこと
- OpenClawのLLM呼び出しは、`StreamFn` を使ってフロントエンドのストリームとモデルを直結させている。
- ここに直接Gemini CLIプロセスを挟み込むのは、TypeScript側の改造コストが大きすぎる（本家の更新に追いつけなくなる）ことが判明。

### ハマったこと・失敗
- **現象**: OpenClaw本体をいじろうとしたが方針転換。
- **対処**: 独立したHTTPプロキシサーバー（`adapter.js`）を立て、OpenAI互換APIとして見せかける「Plan B」アーキテクチャ（ADR-001）を立案。

### 変更したファイル
- `adapter.js` (雛形作成)
- `openclaw.json` (プロバイダ設定の追加)

### 残った課題・TODO
- [ ] `adapter.js` の実装（HTTPサーバー化とSSE応答の実装）

---
# 2026-02-21 開発ログ

## セッション 1: アダプタサーバーの実装と初期テスト

### やったこと
- `adapter.js` をOpenAI互換のHTTPサーバーとして実装。
- `spawn()` を使ってGemini CLIを呼び出し、標準出力をパースしてSSE（Server-Sent Events）でOpenClawへストリーミングする処理を構築。

### 発見・学んだこと
- Gemini CLIは `--yolo` 起動しないと、MCPの実行確認でフリーズする。
- `openai-responses` API仕様で通信を試みたが、ツールコールの受け渡しなどが複雑すぎた。

### ハマったこと・失敗
- **現象**: OpenClaw側でレスポンスが全く来ない（タイムアウト）。
- **原因**: 起動コマンドの誤り（`npm run start` ではなく `node openclaw.mjs gateway` だった）。
- **対処**: 起動コマンドを修正（Runbookへ記載）。

## セッション 2: コンテキスト喪失問題との格闘

### やったこと
- 会話履歴がGeminiCLIに渡らず、AIがすぐ記憶喪失になる問題のデバッグ。
- `openclaw-session-map.json` ファイルを使った、OpenClawセッションとGemini内部UUIDの紐付け。

### 欠陥の発見
- ユーザーテキストしか `--prompt` に渡していなかったため記憶喪失になっていた。GeminiCLIの `~/.gemini/tmp/chats/` 以下のJSONファイルに、過去の `messages` 配列を強制上書き（同期）するハック（ADR-002）を実装。

### ツール履歴注入の泥沼
- **現象**: 会話履歴は同期できたが、「先ほどのツール実行結果」をすぐに忘れる。
- **原因**: OpenClaw側にはテキストストリームしか返っておらず、GeminiCLIが裏で実行したツールの事実がOpenClawの `.jsonl` に保存されていなかった。
- **対処**: SSEレスポンス終了後に、Adapterが直接 `.jsonl` を開き、正規表現で `toolCalls` と `toolResults` を強引に注入するロジック（ADR-004）を実装。

## セッション 3: ストリーミング形式の不整合解消

### やったこと
- `adapter.js` と OpenClaw 間の通信エラー `Cannot read properties of undefined (reading '0')` の解決。

### ハマったこと・失敗
- **現象**: 上記のエラーにより、OpenClawの接続が拒否される。
- **原因**: `openclaw.json` で `api` を `openai-completions` に直したにも関わらず、`adapter.js` のSSE出力が古いまま（`response.output_text.delta`等）だったため。OpenClaw側は `choices[0]` を持つ標準フォーマットを期待していた。
- **対処**: `adapter.js` 内の全ての `sseWrite` を `chat.completion.chunk` 形式に修正。

### メモ
- 完全に挙動が安定。ツールコールの伝播・履歴の維持も確認できた。
