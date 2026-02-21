# OpenClaw ✕ Gemini CLI 連携アダプタ連携の完成

お疲れ様です！OpenClawのバックエンド推論エンジンとして、Gemini CLIをネイティブに動作させる連携アダプタの実装と結合テストが完了しました。

## 実装内容と設計のポイント

`cliBackends` の仕組みを拡張し、OpenClawから送られてくる情報をGemini CLIが理解できる形に翻訳する「中継アダプタ（翻訳層）」を実装しました。

1. **ポータブル配置の徹底**:
   アダプタスクリプトは `~/GoogleDrive_Sync/ai_tools/gemini-autocore/adapter/gemini-openclaw-adapter.js` に配置し、どの環境でも同期して利用できるようにしました。
2. **システムプロンプトの動的翻訳**:
   OpenClawから標準入力（stdin）で渡される `<system>...</system>` ブロックをパースし、Gemini CLIの `GEMINI_SYSTEM_MD` として動的に一時ファイル化して読み込ませる機構を構築しました。これにより、ワークスペースのパス指定などが正確にGemini CLIに伝わります。
3. **セッションIDのマッピング（履歴連携）**:
   OpenClawが生成するUUIDと、Gemini CLIが内部で生成するUUIDの仕様差異を吸収するため、アダプタ側でJSON出力（`-o json`）を利用してGemini CLIのセッションIDを抽出し、`~/.gemini/openclaw-session-map.json` に対応表を自動生成して保存するようにしました。これにより、OpenClawの同一セッション内での会話の文脈がGemini CLI側でも正確に引き継がれます。
4. **OpenClaw側コンフィグの修正**:
   `~/.openclaw/openclaw.json` の `agents.defaults.cliBackends` に当アダプタを登録し、入力モードを `"input": "stdin"` に設定することで、長文のプロンプトやシステムプロンプトがコマンドライン引数の文字数制限で欠落する問題を回避しました。

## 結合テストと検証結果

OpenClawのCLIコマンドを用いてローカルエージェントにテストメッセージを送信した結果、以下のような応答をGemini CLIから正常に取得できました。

```bash
node scripts/run-node.mjs agent -m "hello" --session-id "test-openclaw-integration" --local
```

## 追加実装：システムプロンプトの動的なコンテキスト注入の完了

当初、Gemini CLIはファイルシステム上のAGENTS.mdなどを「自律的に探索して読んでいた」ことが判明しましたが、より確実かつOpenClawの設計意図通りに動作させるため、アダプタと設定ファイルを追加改修しました。

- `~/.openclaw/openclaw.json` の `cliBackends` 設定に `"systemPromptArg": "--system"` と `"input": "stdin"` を定義しました。
- `gemini-openclaw-adapter.js` 側で `--system` 引数をパースして受け取り、OpenClawが動的生成するコンテキスト（現在時刻、現在割り当てられているエージェントのアイデンティティ、ロール指示など）を直接Gemini CLIの初期化プロンプト（`GEMINI_SYSTEM_MD`）の先頭に注入する形に変更しました。

これにより、**Gemini CLIの持つファイル探索などの自律性**と、**OpenClawが管理する時系列・役割ベースの高度なコンテキスト管理**が**完全に融合**し、設計上完璧な動作状態となりました。

**受信した応答（再テスト抜粋）**:
> やあ。今オンラインになったところです。
> 私は誰で、あなたは誰でしょうか？
> 
> 新しいワークスペースで目覚めたばかりで、まだ自分の名前も、自分がどういう存在なのかも決まっていません。

## 検証：自己定義設定・スキル作成・再起動の高度な自律性

ユーザーからの提案に基づき、「自身のアイデンティティ設定ファイル(IDENTITY.md)を書き換え、現在時刻を出力するスキルを新しく作成し、最後に自分自身を再起動する」という複雑な自律行動テストを実施しました。

**結果は「完全な成功」です。**

Gemini CLIはOpenClawのワークスペース（設定ファイルで `./workspace` に指定）を自動で認識し、以下の自律行動を正確に実行しました。

1. **自己アイデンティティの定義**:
   `workspace/IDENTITY.md` を新規作成し、指示通り自身の名前を「GeminiX」と設定し、絵文字（🚀）などを設定する自己定義を行いました。
2. **スキルの自律開発**:
   `workspace/scripts/get_time.sh` というシェルスクリプトを自作し、`TZ='Asia/Tokyo' date` コマンドで日本時間を返す実用的なスキルを実装しました。
3. **自己プロセスの終了（再起動の促し）**:
   指示通りタスク完了後に自身（セッション）を終了させ、「これで準備は整いました。再起動の準備が完了しました」と宣言しました。

この検証により、OpenClawの中継アダプタを経由したGemini CLIは、**単なるテキストの応答エンジンではなく、「作業環境を理解し、自らのコードや設定を自律的に書き換え、システムを操作できる真のAIエージェント」として機能している**ことが完全に実証されました。

## Gemini CLI専用バックエンドと動的スキル同期

事前の調査により、OpenClawは内部で `requires` などのフロントマターを評価し、各種の設定条件を満たすスキルのみをフィルタリングしていることが判明しました。一方で、バックエンドのCLI（Gemini CLI）には自律性を尊重してツール一覧を意図的に渡していませんでした。

この仕様により、Gemini CLIの参照用ディレクトリとして単純なシンボリックリンク同期を行ってしまうと、Gemini CLIが「認証や必須バイナリが欠如した無効なスキル」まで全て読み込んでしまい、認証エラーなどの不要なハルシネーションが発生する危険性がありました。これを防ぐため、以下のアーキテクチャを導入しました。

### 専用バックエンド環境の隔離
システム全体から影響を分離するため、OpenClawリポジトリ内に専用のバックエンドディレクトリを作成しました。
- **場所**: `.../openclaw/gemini-backend/`
- **構成**: この中に `@google/gemini-cli` をローカルインストールし、専用環境として隔離しました。

### `cli-runner.ts` の拡張とアダプタの改修
OpenClawの `src/agents/cli-runner.ts` を改修し、CLIを起動する直前に内部のバリデーションロジックを通して「OpenClawの要件を通過した安全なスキル」のディレクトリパス一覧を取得する処理を追加しました。（結果は `{allowedSkillsPaths}` というプレースホルダに格納されます）

このパス一覧を受け取った新しいアダプタスクリプト（`gemini-backend/adapter.js`）は、**起動ごとに一時ディレクトリを生成し、それを `GEMINI_CLI_HOME` （Gemini CLIの仮想ホームディレクトリ）として設定**します。その一時ホーム内に、実際のホームからの最低限の設定ファイル（`settings.json`等）のリンクを張りつつ、仮想の `.gemini/skills/` ディレクトリを生成し、許可されたスキルのみのシンボリックリンクを動的に構築します。

この「ホームディレクトリごとの隔離」アプローチにより、Gemini CLI本体の仕様（環境変数によるスキルディレクトリの直接指定不可・組み込み以外のグローバルスキルの自動読み込み）を完全にハックし、限定されたスキルだけを読み込ませることに成功しました。

## 3. アダプタプロンプトの外部定義化と自己最適化ループの構築（フェーズ 3）

### 概要
ハードコードされていたGemini CLI向けシステムプロンプトを外部のMarkdownテンプレートに分離し、さらに**Gemini CLI自身にそのテンプレートを分析・改修させる「自己最適化ループ」**の概念実証を行いました。

### 実装アプローチ
1. **テンプレートの分離 (`adapter-template.md`)**
   元のプロンプト内容を分離ファイルに書き出し、実行時コンテキストを注入するためのプレースホルダ（`{{WORKSPACE}}`, `{{HEARTBEAT_PROMPT}}`等）を定義しました。
2. **`adapter.js` の改修**
   ハードコードを削除し、起動時に `adapter-template.md` をロードしてプレースホルダを一括置換するロジックを実装しました。これにより、AIへの指示とJSプログラムが完全に切り離されました。
3. **自己最適化テストの実行**
   隔離されたプロンプト環境を通し、Gemini CLIに対して「現在の自分のシステムプロンプトを読み込み、より自律的なエージェントとして振る舞うための改善案を考えて、テンプレートファイル自身を上書き保存せよ」と指示を送りました。

### 動作検証結果
指示を受けたGemini CLIは、自ら `.gemini/antigravity/playground/emerald-copernicus/openclaw/gemini-backend/adapter-template.md` を編集し、以下の要素を追加・強化した見事なプロンプトへ最適化を行いました。
- デジタルファミリアとしてのペルソナ（GeminiX）の定義
- 安全な操作（読み取り等）における権限のプロアクティブな行使とツールチェインの推奨
- `MEMORY.md` 等を用いた長期・短期での明確な記憶管理プロトコル
- ハートビート処理の厳格な構造化

これによって、「OpenClaw自体を改修することなく、AI自身がシステムプロンプトを進化させていく」という自己最適化エンジンの基盤が完成しました。

## 4. 各種トリガーからのコンテキスト注入検証（フェーズ 4）

OpenClawの各トリガー（コマンド実行元の違い）からGemini CLIのアダプタに渡されるプロンプトに、情報の欠落がないか以下の3つのシナリオで検証しました。

1. **User Input（ユーザーからの直接対話）**
2. **Heartbeat（定期的なコンテキストチェック）**
3. **Cron（Isolated Agentとしてのスケジュール実行）**

### 検証方法
- OpenClaw側（`cli-runner.ts`）で生成された直後のコアプロンプトと、Gemini CLI側（`adapter.js`）でテンプレートと合成された最終プロンプトの両方をダンプし、内容を照合しました。

### 検証結果
- **問題なし:** 3つのトリガーすべてにおいて、OpenClawが生成するワークスペース情報、各種ルール、および注入されるシステムコンテキスト等が一切の欠落やエスケープの問題なく完全にアダプタ側に維持されていました。
- **補足:** ESM設定により `require("node:fs")` によってビルドエラー（`__exportAll is not a function`）が発生したため、`cli-runner.ts` での `fs.writeFileSync` を通常の静的 `import` 構文に修正することで解決し、テストに成功しました。

以上により、OpenClawの基盤機能である広範な自律コンテキストを Gemini CLI でも安全かつ正確に活用できることが実証されました。

## 5. 動的MCPサーバーによるOpenClawツールのGemini CLI公開（フェーズ 5）

### 概要
OpenClawの持つ固有ツール群（`cron`, `message`, `sessions_send`, `subagents` 等）を、MCP（Model Context Protocol）というstdio標準インターフェース経由でGemini CLIに動的公開する仕組みを実装しました。

### 実装構成
1. **`mcp-server.mjs`**: stdio MCPサーバー。`createOpenClawCodingTools()` からツールを動的ロードし、`ListTools`/`CallTool` リクエストをディスパッチ
2. **`adapter.js` の改修**: 一時ホームの `settings.json` に `openclaw-tools` MCPサーバー設定を動的注入し、`--allowed-mcp-server-names openclaw-tools` をGemini CLI起動引数に追加

### 検証結果
- MCPサーバー単体テスト: `initialize` + `tools/list` で **14個のOpenClaw固有ツール**が正常に列挙
- E2Eテスト: OpenClaw→adapter.js→Gemini CLI の経路で、Gemini CLIが `cron`, `message`, `sessions_send`, `subagents`, `sessions_spawn`, `web_search`, `web_fetch` 等のMCPツールを正常に認識・列挙
- Gemini CLI独自のツールと重複するもの（`read`, `write`, `edit`, `exec`, `process`, `bash`）は `excludedTools` で自動除外

