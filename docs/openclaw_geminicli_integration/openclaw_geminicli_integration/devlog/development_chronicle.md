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

## セッション 4: `adapter.js` のモジュール分離とIPバインディング修正

### やったこと
- 939行に肥大化していた `adapter.js` を、責務ごとに6つのファイル（`src/utils.js`, `session.js`, `converter.js`, `injector.js`, `streaming.js`, `server.js`）へリファクタリング。
- エントリポイントを `src/server.js` に変更し、`start.sh` を修正。不要なゴミファイルや過去の残骸を整理、または `docs/samples/` へ移動した。

### ハマったこと・失敗
- **現象**: ユーザー環境で「localhost 接続が拒否されました」というエラーが発生。`pgrep` やログ上ではGatewayもAdapterも正常稼働していた。
- **原因**: Node.jsの `server.listen(PORT, '127.0.0.1')` が明示的にIPv4にバインドしていた一方、ユーザーのアクセス環境（あるいは内部の名前解決）が `localhost` をIPv6の `::1` として解決したため、接続が弾かれた可能性が高い。また、Gatewayも稼働していたが、Websocket用の18789ポートへブラウザで通常のHTTPアクセス（GET `/`）をしたためWebsocketプロトコル外として拒否された可能性も高い。
- **対処**: Adapter側は `127.0.0.1` 指定を外し、`server.listen(PORT, ...)` として全てのインターフェース（IPv4 / IPv6 両方）でリッスンするよう修正。Gatewayプロセスは `ps` コマンドで生存を確認した。

## セッション 5: UXの改善とプロファイリング機能の実装 (2026-02-22)

### やったこと
- **ストリーミングUXの復活:** モジュール分離時に欠落していた、ツール実行中・完了時のプレースホルダーテキスト（`⚙️ Using tool...` 等）を `src/streaming.js` に再実装し、ユーザーの待ち時間ストレスを軽減した。
- **プロファイリング機能の追加:** Gemini CLI本体には時間計測オプションがないため、Adapter側で各イベント（開始、初回トークン、ツール実行開始/終了）のタイムスタンプを取得・計算し、`Time To First Token` や各ツールの `duration` を `adapter.log` に出力する機能を実装した。
- `src/utils.js` の `log()` 関数を修正し、ログ出力時にISO形式のタイムスタンプを付与するようにした。

### ハマったこと・失敗
- OpenClaw側の内部遅延（ユーザー入力〜Adapter到達まで）を計算しようとしたが、OpenClawから送られてくるリクエストデータ内にミリ秒単位の受信時刻が含まれていなかったため、Adapter単体での計測は断念した。Gateway側のログとAdapterの受信時刻を照らし合わせて確認するようユーザーに案内した。

## セッション 6: Gemini CLI のライブラリ化（API直接呼び出し）による抜本的高速化

### やったこと
- **課題**: OpenClawからGemini APIを叩く際、毎回 `bun gemini` プロセスを起動（spawn）しており、その度にかかる約12秒の初期化オーバーヘッド（起動税）が体感速度を著しく下げていた。
- **解決策**: Gemini CLI の内部モジュールを動的importで直接メモリに読み込み、サーバー起動時に1回だけ初期化する「ファサード（Facade）パターン」を採用。リクエスト時にはOSプロセスを起動せず、直接ジェネレータ（`generateContent`）を回す仕組みへアーキテクチャを変更した。
- **新設計**:
  - `src/gemini-core-facade.js`: 変動しやすいGemini CLI内部モジュール（settings, auth, config 等）への依存を1ファイルに隔離し、初期化 `initializeGeminiCore()` と推論 `generateContentDirect()` メソッドのみを露出させる層。
  - `src/server.js`: HTTPリッスン開始前に `initializeGeminiCore()` を呼び出し、Gemini Clientをメモリに常駐（ウォームアップ）させる。
  - `src/streaming.js`: 従来の `spawn()` 呼び出しを破棄し、`generateContentDirect()` から得たテキストをSSE（Server-Sent Events）のJSONLチャンクとしてストリーミング返却する形に書き換え。

### ハマったこと・失敗
- **現象**: 共通Js（CommonJS）形式の `server.js` から、ESモジュール形式で作成した `gemini-core-facade.js` を `require()` しようとしてエラーが発生した。
- **対処**: トップレベルの `(async () => { ... })();` ブロック内で `await import('./gemini-core-facade.js')` を用いて動的ロードするよう修正し解決した。

### 安全弁（フォールバック）の実装
- **現象**: Gemini CLIチームが内部APIの実装やディレクトリ構造を変更した場合、ファサード内部のアダプタが壊れ、以後一切の通信ができなくなるクリティカルなリスク（非互換リスク）が存在する。
- **対処**: `server.js` 起動時の初期化フェーズで例外が発生した場合、グローバルフラグ `useFallbackSpawn = true` を立てる機構を実装。`streaming.js` 側でこのフラグを検知し、もし初期化に失敗していれば「旧来の安全な `spawn`（外部コマンド呼び出し）モード」へ自動後退して動作を継続する高可用性ループ（`runGeminiStreamingFallback`）を構築した。

### 成果
- **TTFT（Time To First Token）が 12秒 → 5.7秒** に半減（実質的な「起動税」約7秒の完全解消）。
- `spawn` プロセスの完全排除により、AdapterサーバーのCPUスパイクやメモリ浪費が抑えられ、エコかつ高速な常駐型APIサーバーへと進化した。

## セッション 7: 文脈（コンテキスト）喪失バグの修正とメッセージマッピングの実装

### やったこと
- **課題**: OpenClaw側から会話履歴を含む `messages` 配列が送信されているにも関わらず、Adapter側は最後のユーザー入力しか抽出しておらず、AIが文脈を一切記憶しない不具合が発覚（「もう一回」と言ってもコンテキストがないので常に「YES」と返されてしまう等）。
- **解決策**:
  - `src/server.js` 側で抽出したメッセージ履歴全体（OpenAI互換フォーマット）を、そのまま `runGeminiStreaming` に渡すよう修正した。
  - `src/streaming.js` において、受け取った `messages` を Gemini SDK互換の `[{ role, parts: [{ text }] }]` フォーマットへ変換・パースするロジックを実装した。
  - Gemini APIの仕様上、同じロール（user/model）が連続するとエラーとなるため、連続する同一ロールのメッセージを結合（Merge）する処理を追加。また配列の末尾が必ず `user` ロールになるようダミーの入力を追加するフェイルセーフを実装した。

### 成果
- パースエラーやSSE（チャンク）出力形式のエラーも解消し、フロントエンド（OpenClaw）側に文脈を踏まえたまともなチャット応答が安定して出力されるようになった。

---
# 2026-02-23 開発ログ

## セッション 8: Warm Standby Runner Pool の実装（起動税ゼロ × ツール完全対応）

### やったこと
- **課題**: セッション6の「ライブラリ直接呼び出し」はTTFTを改善したが、MCPツール実行などのAgentループが動作しない問題があった。
- **解決策（Warm Standby + Queue パターン）**:
  - `src/runner.js` 新規作成。Gemini CLIの `runNonInteractive()` をそのまま呼ぶ「使い捨てRunner」。初期化完了後にIPCで `ready` を送信して待機。
  - `src/runner-pool.js` 新規作成。RunnerPool クラス（常時1プロセスをWarm Standby保持、FIFOキュー付き）。
  - `src/streaming.js` 全面書き換え。RunnerPool統合・JSONLストリーム解析・SSE変換。
  - `src/server.js` からGemini Core初期化処理を削除。
- **会話履歴の受け渡し**: `resumedSessionData`（messages配列を含むJSON）をIPCでRunnerに直接渡す方式を採用し、ディスクI/Oと競合リスクを排除。

### 発見・学んだこと
- Gemini CLIの `runNonInteractive()` は `resumedSessionData`（sessionId + messages構造体）を直接渡せる。
- RunnerのstdoutにはAIの回答以外にユーザープロンプトのエコーが含まれるため `streaming.js` 側でフィルタが必要。

### ハマったこと・失敗
- **現象**: Runner起動直後にIPC送信すると `target closed` エラー。
- **原因**: `ready` シグナルより前にプロンプトが送信されていた。
- **対処**: RunnerPool内でPromiseを使い、`ready` 受信まで送信をブロックする制御フローに変更。

### 成果
- **TTFT: 12秒 → ほぼ0秒**（Gemini CLIの起動税を完全排除）
- **MCPツール（google_web_search、shell、browser等）が完全動作**するようになった

### 変更したファイル
- `src/runner.js` — 新規作成：Warm Standby 実行ランナー
- `src/runner-pool.js` — 新規作成：RunnerPool クラス（プロセス管理・FIFOキュー）
- `src/streaming.js` — 全面書き換え：RunnerPool 統合・SSE変換
- `src/server.js` — Gemini Core 初期化ロジックを削除、RunnerPool へ委譲

---
# 2026-02-24 開発ログ

## セッション 9: 環境復旧および Gemini CLI ツール仕様の調査

### やったこと
- **GoogleDrive_Sync マウントのハング対応**: rclone FUSEマウントが切断状態（ENOTCONN）となり、OpenClawのskillsウォッチャーがシンボリックリンクを踏んでクラッシュする連鎖障害を解決。
  - `~/.antigravity-agent` シンボリックリンクをローカルディレクトリに置き換え（根本対処済み）。
  - `sudo umount -l` で壊れたFUSEマウントを強制解除し、ドライブの再接続に成功。
  - `~/.bashrc_global`, `~/.claude.json`, `~/.local/bin/openclaw`, `~/net_watchdog.py` のシンボリックリンクを解除してローカル実体化。
- **Gemini CLI `google_web_search` ツール仕様調査**: `web-search.js` ソースコードを確認し以下を確認。
  - `model: 'web-search'` という特殊なGemini APIエンドポイントへの単一API呼び出しで完結する。
  - バックエンドでGoogleが検索・ページ取得・要約を一括処理する「Search Grounding」機能を利用（クライアント側からは1回のAPIコールに見える）。
  - これはOpenClawの `web_search`（BraveSearch）/ `web_fetch`（URL直接取得）/ `browser`（Playwright）とは根本的に異なるアーキテクチャ。

### 残った課題・TODO
- [ ] GoogleDrive_Sync 上の `ai_tools/` や `Global_Env/home/` 以下のファイル（`.claude.json` 等）が消失しており、空ファイルで代替中。必要であれば再作成が必要。
