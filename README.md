# OpenClaw Gemini Gateway (Adapter for Gemini CLI)

OpenClawの強力な自律駆動システムと、Googleの公式「[Gemini CLI](https://github.com/google-gemini/gemini-cli)」を**直接かつ安全に**接続するための専用ゲートウェイ（アダプタ）です。

**対応OS: Linux / macOS / Windows**

## 🌟 開発の背景と目的
近年、Gemini（あるいはそれに類するサービス）の内部Google OAuth認証トークンを無断で抽出し、別の非公式ツールに流用する「認証の悪用（トークンスティーラー）」が一時的に流行しました。しかし、Google側はこうした不正なアクセスパターンを検知し始めており、**トークンを不正利用したユーザーのGoogleアカウント自体がBanning（停止処分）される事例**が増加しています。

このプロジェクトは、そうした**「認証の流用」という危険なアプローチを完全に捨て去り**、OpenClawのシステムが「ユーザー環境にインストールされた本物のGemini CLIプロセスそのもの」を直接バックエンドとして起動・操作するアーキテクチャを採用しました。
安全な公式ツールを通してのみ推論を行うため、**アカウント凍結のリスクなしに**OpenClawの自律駆動機能とGeminiの強大なパワーを組み合わせることができます。

## ✨ 主なメリットと機能

### 1. 無料で強力なAIアシスタントを構築
APIキー（従量課金）の取得は不要です。Googleアカウントを使って公式Gemini CLIにログインするだけで、強力な自律型エージェント環境を**完全無料**で体験できます。

### 2. Google検索グラウンディングの標準搭載
公式のGemini CLIをそのまま利用しているため、有償APIを使わなくても**Google検索（グラウンディング）**の能力をフルに活用できます。最新のWEB情報にアクセスしながら、エージェントがタスクを遂行します。

### 3. マルチモーダル対応
Geminiの持つマルチモーダル能力をそのまま引き継いでいます。ローカル画像の読み込みや分析など、高度な推論タスクにも自然に対応可能です。

### 4. OpenClawのスキル・ツール群との完全互換
OpenClaw上で定義されているスキル（`SKILL.md`）やツール群は、本アダプタを経由して安全・確実にGemini CLI側へ引き継がれます。
本リポジトリはGemini CLIを単なるチャットツールから、ファイルの自動編集、コマンド実行、ハートビートによる定期起動をこなす**「自立駆動型エージェント」**へと進化させます。

### 5. 仮想ホームディレクトリによる「スキルの完全隔離」
Gemini CLIの仕様上、通常はローカルに存在するすべてのグローバルスキルが無条件で読み込まれてしまいます。本アダプタは実行ごとに一時的な**仮想ホームディレクトリ（GEMINI_CLI_HOME）**を動的生成し、OpenClawのサンドボックス検証を通過したスキルのみをそこにシンボリックリンクとして注入します。これにより、不要なコンテキスト汚染を防ぎ、極めてセキュアなエージェント制御を実現しています。

### 6. AI自身による「プロンプトの自己進化（Self-Optimization）」
システムプロンプトの枠組みは、独立したMarkdownファイル（`adapter-template.md`）として分離されています。これにより、Gemini CLI自身に対して「現在の自分のプロンプト（adapter-template.md）を読み込み、より自律的なエージェントになるよう最適化して上書きせよ」と指示することで、**AI自身が自らの振る舞いのルールを分析し、コードを書かずに自己進化していく**ことが可能です。

## 🚀 仕組み（Architecture）

```text
OpenClaw デーモン
    │  (stdin/stdout)
    ▼
adapter.js          ← OpenClawのコンテキストをGemini CLIのプロンプトへ翻訳し、特殊な環境変数で隔離起動
    │  (子プロセス)
    ▼
Gemini CLI          ← 公式ツールとして推論・ツール呼び出しを実行
    │  (MCP stdio)
    ▼
mcp-server.mjs      ← OpenClawのツール群（Slack送信、スケジューラ等）をMCP経由で提供
    │  (import)
    ▼
OpenClaw tools
```

## 📁 ファイル構成

| ファイル | 役割 |
|---|---|
| `adapter.js` | OpenClaw↔Gemini CLI のブリッジ（CJS、メインアダプター） |
| `adapter-template.md` | Gemini CLIへのシステムプロンプトテンプレート（AIが自己最適化可能） |
| `mcp-server.mjs` | OpenClawツールをMCP経由で公開するサーバー（ESM） |
| `setup.js` | インストールスクリプト（クロスプラットフォーム） |
| `package.json` | 依存関係（`@google/gemini-cli`, `@modelcontextprotocol/sdk`） |

## 📥 超簡単インストール（依存関係不要）

本ゲートウェイは、**ユーザーの事前準備を極限までゼロ**にするため、強力な自動構築スクリプト（`install.sh` 及び `setup.js`）を搭載しています。
※ Node.js がシステムに無い場合でも、`install.sh` が自動検出して NVM 経由で導入するため、事前の個別インストールは一切不要です！

**セットアップ手順**

### 🍏🐧 macOS / Linux の場合

```bash
# 1. リポジトリをダウンロードして移動
git clone <openclaw-repo>
cd openclaw/gemini-cli-claw

# 2. フルオート・インストーラーの実行
./install.sh
```

### 🪟 Windows の場合

```cmd
:: 1. リポジトリをダウンロードして移動
git clone <openclaw-repo>
cd openclaw\gemini-cli-claw

:: 2. フルオート・インストーラーの実行
install.bat
```

---

実行後、インストーラーが以下の全工程を**対話的かつ完全自動**で完了させます：
1. **Node.jsの確認・自動インストール**（未導入の場合のみ）
2. 言語選択（日本語/English）
3. OpenClaw本体のビルド状態の確認と自動ビルド
4. Gemini Backend（本アダプタ）の npm 依存関係のインストール
5. `~/.openclaw/openclaw.json` への `gemini-adapter` バックエンドの自動登録と環境構築
6. Gemini CLIの認証状況チェックと対話型自動ログインのサポート（ブラウザレスでのQRログイン）

## ⚙️ 詳細な仕様と既存環境への統合

すでに ご自身のマシンに OpenClaw のリポジトリが存在する場合の、詳細な統合仕様は以下の通りです。

### 1. フォルダの配置場所
本リポジトリ（`gemini-cli-claw` フォルダ）は、必ず**OpenClawのルートディレクトリの直下**に配置してください。
インストーラ（`setup.js`）は、自身が置かれた場所の「1つ上の階層（`..`）」をOpenClawのルートとみなしてビルド等の検知を行います。

✅ **正しい配置の例**:
```text
openclaw/
├── src/
├── package.json
└── gemini-cli-claw/   <-- ここに配置
    ├── adapter.js
    ├── install.sh
    └── package.json
```

### 2. 設定ファイル (`openclaw.json`) の自動変更箇所
インストーラを実行すると、OpenClawのグローバル設定ファイル（`~/.openclaw/openclaw.json`）に対し、以下のプロバイダ設定が**パスを絶対パスに解決した上で自動追記**されます。

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "gemini-adapter": {
          "command": "node",
          "input": "stdin",
          "output": "text",
          "systemPromptArg": "--system",
          "args": [
            "/絶対パス/openclaw/gemini-cli-claw/adapter.js",
            "--session-id",
            "{sessionId}",
            "--allowed-skills",
            "{allowedSkillsPaths}"
          ],
          "resumeArgs": [
            /* 同上 */
          ]
        }
      }
    }
  }
}
```

※ この追記により、OpenClawは「`gemini-adapter` という名前のバックエンドを呼び出すと、引数とともに `adapter.js` をNode.jsで実行すればよい」ということを学習します。既存の設定を破壊することはありません。

## 🎮 使い方

### 単発でのテスト実行
まずは正しくGemini CLI経由で接続できているか、OpenClawのルートディレクトリ（`openclaw/`）から以下のコマンドでテストできます（`--local`フラグをつけることで実験できます）。

```bash
node scripts/run-node.mjs agent -m "こんにちは" --local
```

### デフォルトの推論エンジンとして常駐させる
OpenClawのデフォルトプロバイダをGeminiに切り替えるには、`~/.openclaw/openclaw.json` を以下のように編集（追記）します。

```json
{
  "agents": {
    "defaults": {
      "provider": "gemini-adapter"
    }
  }
}
```

この設定を行うことで、OpenClawデーモンの再起動以降、チャット（Telegram, Signal等）やCron、セッション思考の**すべての推論エンジンが無料で強力な `Gemini CLI` に恒久的に切り替わります**。

## MCP ツール

Gemini CLI から利用可能な OpenClaw 固有ツール（`mcp-server.mjs` が公開）:

| ツール | 説明 |
|---|---|
| `message` | Discord / Telegram 等へのメッセージ送信 |
| `cron` | スケジュール実行・リマインダー |
| `sessions_send` | 別セッションへのメッセージ送信 |
| `sessions_spawn` | バックグラウンドサブエージェントの起動 |
| `subagents` | サブエージェントの管理 |
| `web_search` | Brave Search API による Web 検索 |
| `web_fetch` | URL からコンテンツ取得 |
| `memory_search` | 記憶の意味的検索 |
| `gateway` | OpenClaw ゲートウェイの設定・再起動 |

Gemini CLI 自身が持つファイル操作・シェル実行ツールと重複するもの (`read`, `write`, `exec` 等) は自動的に除外されます。

## カスタマイズ

### システムプロンプトの編集

`adapter-template.md` を直接編集することで Gemini CLI のティラの振る舞いをカスタマイズできます。
また、Gemini CLI 自身に `adapter-template.md` を分析・改善させる「自己最適化」も可能です。

### プロンプトの変数

| 変数 | 内容 |
|---|---|
| `{{PROVIDED_SYSTEM_PROMPT}}` | OpenClaw が動的生成するコアプロンプト |
| `{{WORKSPACE}}` | ワークスペースディレクトリのパス |
| `{{HEARTBEAT_PROMPT}}` | ハートビートの指示 |
| `{{HEARTBEAT_CONTENT}}` | HEARTBEAT.md の内容 |
