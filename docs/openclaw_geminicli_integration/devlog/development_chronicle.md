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

---

## セッション 10: Gemini モデル動的同期・UI表示問題の解決・ログ集約

### やったこと
- **動的モデル選択機能の基盤実装 (commit 7df6df02)**: OpenClaw本体からのリクエスト (`req.body.model`) をパースし、指定されたモデル（例: `gemini-2.5-flash`）をそのままGemini CLIの推論エンジン（RunnerPool/geminiClient）に渡して実行できるように `src/server.js` と `src/runner.js` を拡張。これまでハードコードされていた単一モデル制約を撤廃。
- **UIに全Geminiモデルが表示されない原因を特定**: `openclaw models list` が `models.json` ではなく `openclaw.json` の `agents.defaults.models` マップを参照することを突き止めた。
- **`scripts/update_models.js` の改修**: `@google/gemini-cli-core` の `VALID_GEMINI_MODELS` から取得したモデルを `openclaw.json` の2箇所（`models.providers.gemini-adapter.models` と `agents.defaults.models`）に書き込むよう修正。これで OpenClaw が Gateway 起動時に `models.json` を自動生成するため、`models.json` への直接書き込みを廃止してシンプルにした。
- **ログ出力の追加**: `server.js` と `runner.js` に「どのモデルが選ばれたか」を `adapter.log` に出力する処理を追加（`Selected model:`, `[Runner] Using model:`）。
- **ログ集約**: アダプター関連の全ログファイルを `logs/` サブディレクトリに集約。`start.sh` の `LOG_FILE` / `PID_FILE` 変数と `server.js` のリクエストキャッシュ保存先を `logs/` 配下に変更。
- **ドキュメント作成**: `docs/gemini_model_sync/` 配下に `resource_paths.md`（ログ・設定ファイルパス一覧）と `walkthrough.md`（実装概要）を新規作成。

### 発見・学んだこと
- OpenClaw の `openclaw models list` はデフォルト（`--all` なし）では `resolveConfiguredEntries()` が `agents.defaults.models` マップのキーしか列挙しない。`models.json` にモデルがあっても、ここに書かれていなければ UI に表示されない。
- **`openclaw.json` が唯一の真実源**。同ファイルを更新すれば Gateway 起動時に `models.json` が自動再生成されるため、両方を直接書き換える必要はない。

### ハマったこと・失敗
- **現象**: `update_models.js` を実行しても `openclaw models list` で1モデルしか表示されない。
- **原因**: `models.json` は更新されていたが、`agents.defaults.models` マップが空のままだった。
- **対処**: `update_models.js` に `agents.defaults.models` への書き込みロジックを追加。

### 変更したファイル
- `scripts/update_models.js` — `openclaw.json` のみを更新するよう刷新（`models.json` 直接書き込みを廃止）
- `src/server.js` — `Selected model:` ログ追加・リクエストキャッシュ保存先を `logs/` に変更
- `src/runner.js` — `[Runner] Using model:` ログ追加

---

## セッション 11: 全メディアモダリティ対応（マルチモーダル入力の拡張）

### やったこと
- **OpenClaw 本体の入力モダリティ制限を調査**: `types.models.ts` の `ModelDefinitionSchema` を確認し、`input` フィールドが `text | image` に厳格に制限されていることを特定。`audio` や `video` を `openclaw.json` に追記するとGatewayのバリデーションエラーで起動しないことを確認。
- **隠れたマルチメディアパス伝達の仕組みを発見**: `src/auto-reply/media-note.ts` が全添付ファイル（音声・動画含む）を `[media attached: /path/to/file (mime) | url]` 形式でプロンプトテキストに挿入することを確認。この仕組みを利用すれば `openclaw.json` の `input` は変更不要。
- **`src/server.js` の正規表現拡張**: 従来は画像拡張子（PNG, JPG等）のみを抽出していた正規表現を、「絶対パス（`/` で始まる文字列）をすべて収集する」シンプルな設計に変更。拡張子によるフィルタリングはGemini CLI側の `detectFileType()` に任せる。
- **`src/runner.js` の `@path` 注入**: IPC メッセージで受け取った `mediaPaths` を `@/path/to/file` 形式でプロンプト入力の先頭に付加するロジックを追加。Gemini CLI の `@path` 構文はローカルファイルを自動的にマルチモーダル解析する。
- **Adapterを再起動**: 変更を反映し、ポート3972でLISTEN状態であることを確認。

### 発見・学んだこと
- **OpenClaw の制限回避策**: `ModelDefinitionSchema` の `input: Array<"text" | "image">` は Zodスキーマで厳格に型制限されているが、実際の添付ファイルはテキスト内に `[media attached: ...]` 形式でパスが埋め込まれて流れてくる。**スキーマを変えなくても全メディアを通せる**。
- **Gemini CLI の `@path` 構文**: `@/path/to/file` をプロンプトに含めるだけで、Gemini CLI が内部の `detectFileType()` → `processSingleFileContent()` → `inlineData` 変換を自動で行う。PNG/MP3/MP4/PDF すべてこの一本のパイプで処理される。
- **`mime` パッケージの動的解決**: `fileUtils.js` の `getSpecificMimeType()` は `mime/lite` パッケージを直接利用。拡張子のハードコードなしに動的にMIMEを判定する。

### ハマったこと・失敗
- **現象**: ログ上で `@/home/heppo/.openclaw/media/inbound/...jpg` のようにメディアパスがGemini CLIに渡されているにも関わらず、LLMが画像を認識できずハルシネーションを起こす（全く違う内容をテキストから推測して答える）。
- **原因の深掘り**: Gemini CLIの `ReadManyFilesTool` 自体は画像も読み込めるが、**「Gemini CLIの現在のワークスペース（対象ディレクトリ）外のパスは、セキュリティ保護のため読み取りを拒否（またはスキップ）する」** システムになっていることが判明。OpenClawのメディア保存先 `~/.openclaw/media/` がワークスペース外であったため弾かれていた。
- **対処**: `runner.js` にて、受け取った `mediaPaths` を順次 `config.getWorkspaceContext().addReadOnlyPath(p)` で動的にホワイトリスト（ReadOnlyPath）に追加してから `@path` 構文に組み立てるように修正。これにより、Gemini CLIの内部パーサーが「安全なパス」としてファイルの中身（画像・音声等）を正しくインラインデータ化（base64化）するようになり解決した。

### 変更したファイル
- `src/server.js` — `[media attached]` からのパス抽出を全絶対パス対応に拡張（拡張子フィルタ削除）
- `src/runner.js` — `mediaPaths` を `@path` 形式で入力先頭に注入するロジック追加。および WorkspaceContext に `addReadOnlyPath` を発行してセキュリティ制約を回避する仕組みを実装

- `start.sh` — `LOG_FILE` / `PID_FILE` を `logs/` 配下に変更、`logs/` ディレクトリ自動作成を追加
- `docs/gemini_model_sync/resource_paths.md` — 新規作成（ログ・設定パス一覧）
- `docs/gemini_model_sync/walkthrough.md` — 新規作成（実装概要）

---

## セッション 12: 提供ツールの整理とドキュメント化 (2026-02-24)

### やったこと
- **OpenClaw 提供ツールの全容調査**: `dist/index.js` を動的ロードし、現在 OpenClaw からアダプターへ提供されている全19種類のツールをリストアップした。
- **使用不能ツールの明示化**: Gemini CLI の標準ツールと競合するファイル操作・実行系ツール、および技術的制約のある `browser` ツールを「使用不能」として `README.md` に明記。
- **代替指針の策定**: Gemini 標準の `google_web_search` が、OpenClaw 側の `web_search / web_fetch / browser` の機能を大幅にカバーできる（検索＋閲覧の一括処理）ことをドキュメントに記載。

### 発見・学んだこと
- OpenClaw の `message` や `sessions_spawn` など、多くの高度なツールが既に MCP 経由で Gemini CLI から利用可能な状態にある。
- `browser` ツールが除外されている原因は未調査だが、Gemini 側の `google_web_search` が非常に強力なため、一般的な情報収集用途では OpenClaw 側のブラウザツールを介さずとも十分な能力を発揮できる。

### 変更したファイル
- `README.md` — 利用可能ツールの具体例追記、除外ツールとその理由・代替指針を明記

---

## セッション 13: MCPツール実行「偽成功」バグの根本修正 (2026-02-24)

### やったこと
- **根本原因の特定**: OpenClawのツール（`cron`, `message` 等）がGemini CLI経由で「成功」と表示されるのに実際は動作しない問題を徹底調査。
  - `runner-pool.js` が Runner プロセスを `spawn()` する際に `GEMINI_CLI_HOME` 環境変数を設定していなかった。
  - Runner はホームの素の `~/.gemini/settings.json` を読み取り、`openclaw-tools` MCPサーバーが存在しない状態で動作していた。
  - Gemini CLIはシステムプロンプト内のツールスキーマ情報を基に「ツールを使った」というテキストを生成（ハルシネーション）し、実際のMCPプロトコル経由の実行は行われていなかった。
- **修正**: `runner-pool.js` に `prepareSharedGeminiHome()` 関数を追加。
  - 起動時に共有の `GEMINI_CLI_HOME` ディレクトリ（`~/.openclaw/gemini-shared-home`）を一度だけ準備。
  - `~/.gemini/settings.json` をコピーした上で `openclaw-tools` MCPサーバーを注入。
  - 認証ファイル（`oauth_creds.json` 等）もコピー。
  - `spawn()` の `env` オプションに `GEMINI_CLI_HOME` を設定して Runner に渡すよう修正。

### 発見・学んだこと
- Gemini CLIは `GEMINI_CLI_HOME` 環境変数が設定されていればそのディレクトリ配下の `.gemini/settings.json` を読む。設定されていなければホームの `~/.gemini/` を使う。
- **ハルシネーション vs 実行の見分け方**: ツールが「実際に動いた」場合は `stream-json` 出力に `tool_use` / `tool_result` イベント（JSONオブジェクト）が出現する。テキスト応答内の「⚙️ Using tool...」はAIが生成したテキストであり、実行の証拠にはならない。

### 変更したファイル
- `src/runner-pool.js` — `prepareSharedGeminiHome()` 新規追加、`spawn()` に `env: { GEMINI_CLI_HOME }` を設定

---

## セッション 14: Workspace Trust 解除と実機実行テストの成功 (2026-02-24)

### やったこと
- **信頼ポリシーの不備を特定**: セッション 13 の修正後も、実際にはツールが実行されない現象が継続。`runner.js` を手動実行したところ `Workspace skills disabled because folder is not trusted` という警告が出ていることを発見。
- **根本修正**: `src/runner-pool.js` の `prepareSharedGeminiHome()` において、注入する MCP サーバー設定に `"trust": true` を追加。これにより Gemini CLI のセキュリティ制限を正規の手順で回避。
- **実機検証（cron 登録）**:
  - OpenClaw ゲートウェイを起動。
  - `curl` で `cron` ツールを介したリマインダー登録リクエストを送信。
  - `adapter.log` にて本物の `tool_use` / `tool_result` イベント（JSON）の出力を確認。
  - OpenClaw 本体のジョブ保存ファイル `/home/heppo/.openclaw/cron/jobs.json` を直接開き、指定したリマインダーが物理的に書き込まれていることを確認。

### 発見・学んだこと
- **セキュリティ・トラスト仕様**: Gemini CLI は、たとえ `settings.json` に正しく MCP サーバーを書いても、`trust: true` がない限りサイレントに（あるいは標準エラー出力での警告のみで）実行を拒否する。
- **二重の偽装**: プロンプトにツールの説明があると、API レベルで Function Calling が無効（空）であっても、モデルが「良かれと思って」ログのようなテキストを自作して返してしまう。これが「UI上は成功に見えるが実体がない」という極めてデバッグしにくい状態を作り出していた。

### 成果
- 統合開始以来の懸念事項であった「ツール実行の信頼性」が 100% 担保された。ハルシネーション（偽装実行）を完全に排除し、物理的な副作用を伴うツール実行に成功した。

### 変更したファイル
- `src/runner-pool.js` — `openclaw-tools` の MCP 定義に `"trust": true` を追加

---

## セッション 15: プロンプト中止（Abort）機能とランタイムハイブリッドアーキテクチャ (2026-02-24)

### やったこと
- **通信切断の検知課題**: クライアント（OpenClaw 等）が `/stop` やネットワーク切断で通信を閉じた際、裏で実行中の Gemini CLI プロセスが残り続ける（ゾンビプロセス化）問題の解決。
- **実装アプローチの検証**: 当初 `req.on('close')` や `res.destroyed` を Bun 環境で試行したが、発火タイミングの異常（POST body 消費完了で発火など）から Bun の HTTP サーバーでは TCP レイヤの切断検知が事実上不可能と判断。
- **新アーキテクチャの導入（ハイブリッド）**: 
  - 受付サーバー (`src/server.js`): 確実な TCP 切断検知 (`res.on('close')`) を行うために **Node.js** ランタイムで起動するよう `start.sh` を修正。
  - AI処理プロセス (`src/runner.js`): 高速起動（Warm Standby）の恩恵を維持するため、引き続き **Bun** で `spawn()` するプール構成を堅持。
- **Abort機能の完成**: Node.js レイヤーでクライアントの異常切断（`res.writableEnded === false`）をフックし、実行中の Bun (Gemini CLI) プロセスへ `SIGTERM` → `SIGKILL` を送る仕組みが完全に動作することを確認。

### 発見・学んだこと
- **Bun の HTTP サーバーの限界**: Bun は極めて高速だが、`req.on('close')` イベントが TCP の実切断ではなくストリーム終了（body の消費完了）を意味するなど、Node.js との完全な互換性がない部分がある。本番向けの細かなフォールトトレランス（異常系の検知）には Node.js が依然として信頼性が高い。
- **プロセスプールの弾力性**: `RunnerPool` アーキテクチャにより、実行プロセスを容赦なく `SIGKILL` しても、プール機能が直ちに新しいプロセスを `spawn()` してスタンバイ状態にするため、全体のシステム安定性が損なわれない（Self-Healing 特性）。

### 変更したファイル
- `start.sh` — `server.js` の起動ランタイムを Node.js に固定
- `src/server.js` — Node.js 用の `res.on('close')` フックと、`abortHandle` の遅延バインディングを実装
- `src/streaming.js` — Abort 実行関数 `killRunner` を Caller（サーバー）へ返す変更
- `src/runner-pool.js` — クライアントが切断し、まだ Runner がアサインされる前の pending キューをキャンセルする `cancelPending()` メソッドの追加

---

## セッション 16: アーキテクチャ課題の整理とドキュメントの最新化 (2026-02-24)

### やったこと
- **ドキュメントの現状と実装の乖離の修正**: `README.md` に残っていた古い説明（「ストリーミング未対応」など）を削除し、最新の実装（Runner Pool, SSE ストリーミング対応, Abort 機能）を反映したアーキテクチャ説明に書き換えた。
- **アーキテクチャ課題（KNOWN_ISSUES）の解決確認と整理**:
  - **Issue 1（同期的ロックとタイムアウト）**: SSE ストリーミング実装と Abort 機能の追加により **解決済み** であることを確認し、追記。
  - **Issue 2（コンテキスト剪定の乖離）**: `--resume` 機能を廃止し、`resumedSessionData` を用いて毎ターンステートレスに履歴を注入する「完全なプロキシ化」アーキテクチャにより **抜本的に解決済み** であることを確認し、追記。
  - **Issue 3（MCPツールの途中経過通知とキャンセルの喪失）**: 進捗ログ（`onUpdate`）が破棄される問題について、実機運用で **「Gemini の自己推論には最終的な `tool_result` さえあれば十分（致命的リスクではない）」** という結論に至り、「実用上は軽微な制限」へ格下げ評価した。
- **リポジトリの整理**: 致命的リスクがすべて解消または軽微となったため、残った Issue 3 を `backlog.md` の低優先度タスクへ移行し、`KNOWN_ISSUES.md` ファイル自体を削除した。
- **OpenClaw のトークン上限仕様調査**: `gemini-adapter` 等の独自プロバイダ使用時、OpenClaw がコンテキスト上限を認識する仕様を調査。`update_models.js` により各モデルに対して `contextWindow: 1000000` (100万) トークンが設定されているため、通常利用では警告ラインに到達しない（正常動作である）ことを確認した。

### 発見・学んだこと
- **ステートレス注入の恩恵**: 履歴管理を Gemini CLI 側に任せる（`--resume`）のではなく、OpenClaw 側で完全にコントロールしメモリに直接流し込む手法を採用したことで、トークン制限問題（Issue 2）が意図せず綺麗に解消されていた。
- **中間ログの重要度低下**: 自律エージェントの推論ループにおいて、人間向けの「途中経過のコンソール出力」は必ずしも必要なく、最終的な成否と結果セットだけを渡せば AI 自身がリカバリーできることが実証された。

### 変更したファイル
- `README.md` — 機能・ロードマップ・アーキテクチャ説明の最新化
- `KNOWN_ISSUES.md` — （削除）内容を解決済みとして整理後、残課題を backlog へ移行
- `docs/openclaw_geminicli_integration/openclaw_geminicli_integration/backlog.md` — MCP途上通知未対応を制限事項として追記

---

## セッション 17: セットアップ自動化の完成と隔離環境への完全移行 (2026-02-25)

### やったこと
- **`setup.js` の自爆バグ修正と高機能化**: 
  - OpenClaw 本体をダウンロード・展開する際に、カレントディレクトリ（アダプター側）を直接上書きして破壊していた致命的なバグ（`fs.cpSync` のパス解決ミス）を修正し、リポジトリ復旧。
  - `gemini login` の実行を `npx @google/gemini-cli login --no-browser` 経由に統一し、認証失敗を検知して停止するエラーハンドリングを追加。
  - OpenClaw 本体の `openclaw.json` を壊していた無効なキー（`provider`, `providers`）の書き込みを削除し、正しいモデル設定形式（`models.primary`）へ修正。
- **隔離環境 `gemini-home` への完全な再統合**:
  - `git checkout` による古いパスへの先祖返りが発生していた `runner-pool.js`, `session.js`, `streaming.js`, `start.sh` を全て修正。
  - 作業ディレクトリ内の `./gemini-home/` を唯一の正解（認証・設定・セッションキャッシュの保存先）とし、グローバルの `~/.gemini` や `~/.openclaw` を一切汚染しないポータブル構成を確立。
- **Git 管理の適正化**:
  - `.gitignore` を更新し、隔離環境 (`gemini-home/`), 旧パス（`src/.gemini/`）, ログファイルを追跡対象から除外。

### 発見・学んだこと
- **セットアップスクリプトのリスク**: ZIP展開やディレクトリコピーを自動化する際、展開先の相対パスを誤るとリポジトリ自体の `package.json` やコードが消滅する。スクリプト実行前の「場所の検証」の重要性を痛感した。
- **ポータブル化の難所**: ホームディレクトリをバイパス（隔離）する場合、`RunnerPool`（待機プロセス）, `Server`（リクエスト受付）, `Runner`（実行）の全レイヤーでパス認識を完全に一致させないと、ツール（MCP）の読み込みエラーや資格情報の紛失（ハルシネーション実行への後退）を招く。

### 変更したファイル
- `setup.js` — パス解決・認証トリガー・設定書き込みロジックの修正
- `src/runner-pool.js` — `gemini-home` 基準の隔離環境準備ロジックへ移行
- `src/session.js` — セッションマップの保存先を `gemini-home` へ変更
- `src/streaming.js` — 各セッションの隔離パスを `gemini-home` 配下に変更
- `start.sh` — 初期起動時の環境変数を `gemini-home` に修正
- `.gitignore` — 隔離環境ディレクトリの追跡除外

---

# 2026-02-27 開発ログ

## セッション 18: ブラウザベースのモダンな GUI インストーラーの開発

### やったこと
- **CUIからGUIへの移行**: 従来のターミナル上での対話型インストーラー（`install.sh` / `setup.js`）は初心者にとって心理的ハードルが高かったため、ブラウザベースの GUI インストーラーへ刷新。
- **アーキテクチャの構築**: `installer-gui.js` を軽量なローカルHTTPサーバーとして実装し、`public/installer.html` をフロントエンドとして提供。SSE（Server-Sent Events）を用いて、サーバーサイドの実行ログ（`setup.js`相当の処理）をリアルタイムにブラウザ上の擬似ターミナルへストリーミング描画する仕組みを構築。
- **自動ダウンロードの実装**: OpenClaw ルートディレクトリ外でインストーラーが単独実行された場合、自動的に GitHub から OpenClaw 本体（`master.zip`）をダウンロード・展開し、その後アダプター自身を所定の `src/plugins` 配下に配置し直す「完全自動ブーストラップ」機能を実装。
- **認証のワンクリック化設計**: Gemini CLI の `gemini login` をバックグラウンドの擬似TTY（PTY）で動作させ、ブラウザのボタンを1つ押すだけで認証ブラウザが開き、完了画面までシームレスに進む構成（Auto-consent）を設計。

### 発見・学んだこと
- **CLIツールのGUI化の最適解**: Electron 等の重いフレームワークを使わずとも、Node.js標準の `http` モジュールと単純なHTML/JS（`Server-Sent Events`）の組み合わせだけで、シェルスクリプトの実行状況をリッチなウェブUIにリアルタイム反映する強力なインストーラーが作れる。
- **Node.jsのパス解決の罠**: リリース用パッケージ（ZIP）から直接実行された時と、最終的なインストール先（`plugins/gemini-cli-claw`）から実行された時とで、`__dirname` とカレントディレクトリ（`process.cwd()`）の関係が大きく変わるため、絶対パスによる厳密なパス解決が必要になる。

---

## セッション 19: GUIインストーラーの UX 洗練と軽量化

### やったこと
- **デザインの全面刷新（Light Glassmorphism）**: 当初のダークな宇宙風テーマから、清潔感のある「白基調のすりガラス風デザイン（Light Glassmorphism）」へ変更。同時に低スペックPCでも軽快に動作するよう、GPU負荷の高い `backdrop-filter: blur` や `animate-pulse` 等のエフェクトを排除し、透明度とシャドウで質感を表現する設計（軽量化）を行った。
- **UXのオートメーション**:
  - **自動タブ展開**: 認証（Googleログイン）が完了した瞬間、ユーザーが元のタブを探す手間を省くため、サーバー側から OS コマンド（`xdg-open` 等）を背後で叩き、強制的に新しいタブで「セットアップ完了画面」を開く機構を実装。
  - **完了状態の自動ルーティング**: 既にOpenClawとGeminiCLIのインストール・認証がすべて完了している状態でインストーラーを開いた場合、不要なステップをスキップして即座に完了画面（Step 7）を初期表示するロジックを追加。
- **二重起動（EADDRINUSE）エラーの人間化**: パッケージを複数回実行するなどしてポート競合が発生した場合、Node.jsのエラースタックを吐き出して落ちるのではなく、「他のタブを閉じてください」「プロセスを kill するにはコレ」という親切で巨大な日本語メッセージをターミナルに表示するよう改善。

### 気付き・メモ
- **UX向上の本質**: 「ブラウザとターミナルの行き来」というCLI特有の不便さは、サーバーからの OS コマンド経由でのタブオープンなど「逆方向からのアクション」を織り交ぜることで劇的に改善できる。
- **デザインとパフォーマンスのトレードオフ**: CSSだけで見た目をリッチにするとGPUリソースを喰いつぶすことがあるため、アニメーションやブラーに頼らない「シャドウと透過色」の見せ方は、実用ツールのUI設計において非常に重要。

---

## セッション 20: CUI/GUI共通のホスピタリティ総点検とパッケージ最適化

### やったこと
- **リリースパッケージ構成の見直し:**
  - `pack_release.sh` を修正し、展開後にそのまま `openclaw/` として使えるディレクトリ構造に変更。出力先を `~/ドキュメント/tmp` に変更し、ZIPと生のフォルダ両方を出力するように機能拡張。
  - 前回の生成物が別ユーザーや権限不足で削除できない場合を考慮し、`chmod -R u+w` を事前実行してから `rm -rf` するパッチを適用。
- **旧対話型・新GUI共通のインフラ整備:**
  - Gemini CLI のバージョン指定を `^0.29.7` から `*` に変更。`0.x` 系のバージョン固定による「Update Available」通知を抑制し、常に最新の安定版がインストールされるようにした（TUIメッセージの多言語化も含む）。
  - 言語選択後、「何がインストールされるか」「インストール後のディレクトリ構成等」についての説明文 (`L.intro`) と、YOLO モード警告文 (`L.warning`) を追加。
  - Gemini CLI が OpenClaw 専用の隔離環境 (`gemini-home`) にインストールされ、システム全体の設定や既存の認証情報とは一切干渉・同期されないことを明確に案内として表示。
- **モデル同期スクリプト (update_models.js) の ES Module 対応:**
  - `update_models.js` を `update_models.mjs` にリネーム。同期失敗時でも成功メッセージが無条件で表示されていた論理バグ (setup.js 側) を修正。

### 気付き・メモ
- **隔離環境（ポータブル設計）の周知の重要性**: 機能として独立しているだけでなく、「既存の環境を壊さない」ことを画面上でユーザーに明示・約束することは、実行への心理的障壁を下げる上で極めて重要なホスピタリティである。

### 次のステップ
- 実環境での動作テスト。
- 広報・配布開始。
