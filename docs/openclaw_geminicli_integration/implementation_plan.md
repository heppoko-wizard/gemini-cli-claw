# OpenClaw × Gemini CLI 疎結合アダプタ 実装計画 v3（最終版）

## 概要
OpenClawの推論エンジンとしてGemini CLIを非破壊的に接続するアダプタ。
OpenClawは外部CLI（`cliBackends`）を呼び出す際、OpenClaw固有の指示やツール一覧を含むシステムプロンプトをテキストとして同時に渡す仕様がある（`<system>`タグでラップされる）。
これをGemini CLIがそのまま受け取ると「存在しないOpenClawツールを使え」という指示と衝突し混乱する。

そのため、中間に **「プロンプト翻訳層（中継Nodeスクリプト）」** を挟む。
この中継スクリプトはOpenClawからの入力をパースして有用な情報（ワークスペースパス、HEARTBEAT.mdの中身など）だけを抽出し、Gemini CLI専用のクリーンなシステムプロンプト（`GEMINI_SYSTEM_MD`）を動的生成してGemini CLIを呼び出す。

## アーキテクチャ概要

```mermaid
graph TD
  OpenClaw["OpenClaw (Gateway層)"]
  Adapter["Adapter Script (中継層)"]
  GeminiCLI["Gemini CLI (実行層)"]
  Workspace["ローカルファイル<br/>(HEARTBEAT.md等)"]

  OpenClaw -->|コマンド起動 + 標準入力(生のプロンプト)| Adapter
  Adapter -->|1. パース \u0026 抽出| Adapter
  Adapter -->|2. GEMINI_SYSTEM_MD 動的生成| GeminiCLI
  Adapter -->|3. geminiコマンド起動<br/>(ユーザー本文のみ渡す)| GeminiCLI
  GeminiCLI <-->|ネイティブツールで読み書き| Workspace
  GeminiCLI -->|標準出力(最終テキスト)| Adapter
  Adapter -->|標準出力| OpenClaw
```

---

## 独自アダプタ（翻訳層）の役割と処理フロー

アダプタ本体は `gemini-openclaw-adapter.js` (Nodeスクリプト) として実装する。

### 1. 入力パース
OpenClawは標準入力に以下のようなフォーマットでデータを渡す。
```markdown
<system>
You are a personal assistant running inside OpenClaw.
...
Your working directory is: /path/to/workspace
Heartbeat prompt: ping
...
## /path/to/workspace/HEARTBEAT.md
- check emails
</system>

ping  <-- ユーザーメッセージ(Heartbeat)
```

**アダプタの処理:**
- `<system>...</system>` ブロックを抽出して削除
- ワークスペースパス（`Your working directory is: (.*)`）の抽出
- HEARTBEAT.md の中身の抽出
- `ping` のようなユーザーメッセージ（コマンド本文）の分離

### 2. Gemini CLI用システムプロンプトの動的生成
抽出した情報を元に、Gemini CLIが自身のツールとスキルで動けるような `system.md` を動的に生成する。

```markdown
# OpenClaw Gemini Gateway

あなたのワークスペースは `${Workspace}` です。
あなたはOpenClawのバックエンドとして動作しています。

## スキルとツール
\${AgentSkills}
以下のツールが利用可能です： \${AvailableTools}

## Heartbeat処理
現在Heartbeatによって起床しました。
以下の `HEARTBEAT.md` の内容を確認し、タスクがあれば実行してください。
完了したら結果を報告し、HEARTBEAT.md を更新してください。
タスクが何もない場合は、完了報告として `HEARTBEAT_OK` という文字列だけを返してください。

### HEARTBEAT.md
${HeartbeatContent}
```

### 3. Gemini CLIの起動と返却
- 生成した一時ファイルを `GEMINI_SYSTEM_MD` 環境変数にセット
- `gemini --resume <セッションID> --yolo` を起動し、分離した「ユーザー本文」だけを渡す
- Gemini CLIの標準出力を受け取り、そのままOpenClawに返す

---

## 実装ステップ

### ステップ1: OpenClawの `cliBackends` にアダプタを登録
`.openclaw/config.json` に中継スクリプトを登録。
```json
"cliBackends": {
  "gemini-adapter": {
    "command": "node",
    "args": ["~/GoogleDrive_Sync/ai_tools/gemini-autocore/adapter.js", "{sessionId}"],
    "input": "stdin",
    "output": "text",
    "sessionMode": "always"
  }
}
```

### ステップ2: アダプタスクリプトの実装 (`adapter.js`)
- Node.jsで標準入力をバッファリングして読み込む
- 正規表現でOpenClawの `<system>` をパース
- `fs.writeFileSync` で動的 `system.md` を出力
- `child_process.spawn` で `gemini` コマンドを実行し、パイプで繋ぐ

### ステップ3: コンテキスト剪定（Pruning）の同期
（前回の議論の通り、別途監視スクリプトでOpenClaw側のログ剪定をGemini CLIのセッションファイルに反映する仕組みも実装する）

---
これにて、「OpenClawのコード改変なし」「Gemini CLIのコード改変なし」「ツールとコンテキストの混乱なし」という**完璧な疎結合アーキテクチャ**が完成する。

---

## フェーズ5: 動的MCPサーバー自動生成アダプターの実装 (Dynamic MCP Server)

OpenClawは外部CLIに対して自身のツールを無効化（`tools: []`）して渡しています。しかし、Gemini CLI側からもOpenClaw固有の高度なツール（エージェント連携、Slack/Discord通知、Cron等）を利用できるようにするため、MCP (Model Context Protocol) サーバーとして機能するアダプターを構築します。

### アーキテクチャ設計
1. **ツールの動的インポート:** 
   `adapter.js` から OpenClaw内部の `createOpenClawCodingTools` などを呼び出し、現在ロードされている `AgentTool` インターフェースのツール群を動的に取得します。
2. **MCPサーバーの動的生成:**
   `@modelcontextprotocol/sdk` を利用し、取得したツール群の情報を元にMCPサーバーの `ListToolsRequest` に対して動的に応答する仕組みを作ります。これにより、手動でのハードコードをゼロにし、今後のOpenClawのアップデートにも自動追従します。
3. **リクエストマッピング:**
   MCPの `CallToolRequest` が飛んできた場合、ツール名で元の `AgentTool` を引き当て、その `execute(params)` メソッドにディスパッチします。
4. **子プロセス構成:**
   標準入出力（stdio）はすでにGemini CLIとOpenClaw本体との対話に使われているため、MCP通信用には別途 `mcp-server.js` などのスクリプトをデーモンとして立ち上げるか、あるいはGemini CLIから子プロセスとして起動させる形式とします。

### 実装ステップ
- **ステップ1**: `@modelcontextprotocol/sdk` のインストールと基盤準備
- **ステップ2**: `mcp-server.js`（独立したMCPサーバ起動スクリプト）の実装
- **ステップ3**: `adapter.js` 側での `--mcp-config` コマンドライン引数の動的生成とGemini CLIへの受け渡し
- **ステップ4**: OpenClawのツールをGemini経由で呼び出すエンドツーエンド検証

---

## フェーズ6: アダプタの最適化 (冗長なテンプレートの廃止)

### 概要
OpenClawの `cli-runner.ts` が、コンテキストに応じて必要なシステムプロンプト（ペルソナ、ツールの使い方、Heartbeatの指示など全て）を完璧なMarkdown形式として動的に構築し、`<system>`タグで渡す仕様であることが判明した。
そのため、中間層である `adapter.js` が外部テンプレート（`adapter-template.md`）を用いてそれを再ラップしている処理が結果的に冗長になっていた。これを廃止し、アダプタのロジックをよりシンプルに最適化する。

### 実装ステップ
1. **`adapter.js` のリファクタリング:** `adapter-template.md` のファイル読み込み・プレースホルダ置換のハードコードを削除。`<system>`タグで囲まれた `systemBlock` をそのまま最終的なシステムプロンプト（`GEMINI_SYSTEM_MD`用）として書き出すように変更する。
2. **冗長ファイルの削除:** 役割を終えた `adapter-template.md` を物理的に削除する。
3. **検証:** 改修後の `adapter.js` 経由でGemini CLIが正常にプロンプトを受け取り、これまで通り動作することを確認する。
