# OpenClaw Gemini CLI Adapter (openclaw-gemini-cli-adapter)

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JA.md)

[![最新リリース](https://img.shields.io/github/v/release/heppoko-wizard/openclaw-gemini-cli-adapter?label=%E6%9C%80%E6%96%B0%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9&style=flat-square)](https://github.com/heppoko-wizard/openclaw-gemini-cli-adapter/releases/latest)

[OpenClaw](https://github.com/mariozechner/openclaw) のバックエンド推論エンジンとして、Google公式の [Gemini CLI](https://github.com/google/gemini-cli) を直接接続するためのアダプタツールです。
Gemini CLI そのものに「自立駆動型エージェント」としての側面を与え、OpenClawの強力な自律性とスキル群をGemini CLIから直接扱えるようにします。

## 開発の背景

近年、Gemini CLIのGoogle OAuth認証ロジックを非公式に流用したサードパーティツールの流行により、ユーザーのアカウントが停止される事例が多数報告されています。
本ツールはこのような「認証の流用」を行わず、**「OpenClawのシステムが、ユーザーのローカル環境にある正規のGemini CLIコマンドを直接起動して操作する」** というアーキテクチャを採用することで、アカウントリスクを回避しつつ安全にエージェント環境を構築することを目的に制作されました。

## 機能・メリット

*   **完全無料でのエージェント体験**: APIキーは不要です。Googleアカウントで `gemini login` を行うだけで、無料で自律駆動型エージェントを利用できます。
*   **検索グラウンディング対応**: Gemini CLIが持つ「Google検索グラウンディング」機能がそのまま利用できるため、無料で最新情報にアクセスした推論が可能です。
*   **マルチモーダル完全対応**: 画像・動画・PDFなどのファイルを直接読み込ませての推論に対応しています。
*   **リアルタイムストリーミング返答**: 応答開始から文字が順次届くSSEストリーミングに対応しており、ネイティブのチャット体験を実現しています。
*   **ストップコマンドによる安全な中断**: 生成処理中に `/stop` で接続を切断すると、裏で動くGemini CLIプロセスも瞬時に強制終了されます。ゾンビプロセスは残りません。
*   **動的MCPサーバーのネイティブ統合**: OpenClawの強力なツール群（`message`, `tts`, `browser`, `web_search`, `sessions_spawn` など）を、Gemini CLIがネイティブに認識できる **MCP (Model Context Protocol)** サーバー形式で自動マッピングし提供します。
*   **OpenClawの基盤スキル活用**: OpenClawが持つ「Heartbeat（自律鼓動）」やファイルシステムアクセス、スケジューリングなどのシステムがGemini CLIでそのまま動作するよう設計されています。
*   **独立した安全な隔離環境**: 実行時に独自のセッションと分離されたテンポラリ環境（`GEMINI_CLI_HOME`）を構築し、許可されたスキルのみを安全に連携させます。

## 必要条件
*   コマンドライン環境と基本的なツール (`git`, `curl` 等)
*   Googleアカウント（セットアップ時にブラウザでのログインが必要です）
*   *※ Node.js(v18+) や OpenClaw本体 は、インストーラーが不足を検知し自動的にダウンロード・設定を行います。*

## インストール仕様と場所について

本アダプタは**「ポータブル（自己完結型）」**な設計になっています。システムディレクトリにファイルをコピーしたり、環境を汚したりすることはありません。

*   **インストール先**: ZIPを展開した（または `git clone` した）**そのフォルダ自体**が実行場所になります。
*   **仕組み**: セットアップスクリプト (`setup.js`) は、そのフォルダ内に依存関係をインストールし、OpenClawの設定ファイル (`~/.openclaw/openclaw.json`) にその場所を**絶対パス**で登録するだけの処理を行います。
*   **移動と削除**: フォルダを移動した場合は再度 `setup.js` を実行すればパスが更新されます。削除したい場合は、フォルダを丸ごと削除して `openclaw.json` から参照を消すだけで、システムにゴミを残さずクリーンにアンインストールできます。

## インストール (クイックスタート)

もっとも簡単な方法は、同梱されている自動セットアップスクリプトを実行することです。
このスクリプトは、環境チェック、OpenClaw本体のクローン・ビルド、アダプタの登録(`openclaw.json`)、そしてGemini APIの認証(`gemini login`)の全てを全自動で行います。

**【⚠️ インストール時の重要事項】**
*   **インストール時間の長さ:** OpenClaw本体のビルド（TypeScriptコンパイル等）や、連携専用のGemini CLIを含むnpmパッケージのダウンロードをすべて一括で行うため、環境によっては**完了までにかなりの時間（数分以上）がかかります。** ターミナルが止まっているように見えても、完了メッセージが出るまで閉じずにお待ちください。
*   **専用のGemini CLI環境:** このインストーラーはシステム環境を汚染しないよう、グローバルではなく本ツール専用の `gemini-cli` をこのリポジトリ直下(`node_modules`)に直接ダウンロードして隔離利用します。

### 実行手順

**既にOpenClawをご利用中（インストール済み）の方:**
必ず、ダウンロードしたこの `openclaw-gemini-cli-adapter` フォルダごと、既存の `openclaw` フォルダの**直下**に移動させてからインストールスクリプトを実行してください。
（配置例: `openclaw/openclaw-gemini-cli-adapter/install.bat` となるように配置する）

**まだOpenClawを導入していない一番最初の方:**
任意のフォルダで以下のスクリプトを実行すれば、インストーラーが自動的にOpenClaw本体をダウンロード(git clone)して構築まで行います。

**Linux / macOS:**
```bash
# このリポジトリフォルダに移動して以下を実行
chmod +x install.sh
./install.sh
```

**Windows:**
エクスプローラーからこのフォルダ内の `install.bat` をダブルクリックするか、コマンドプロンプトで以下を実行してください。
```cmd
install.bat
```

## 使い方

OpenClawの設定 (`openclaw.json`) にて、メインの推論エンジンをGeminiアダプタに切り替えて使用します。

```json
"models": {
  "primary": "gemini-adapter/default"
}
```

設定後、通常通りOpenClawのCLIやTelegram/Discordインターフェースからメッセージを送信すると、バックエンドでGemini CLIが起動し、応答を返します。

## アーキテクチャ

本アダプタは OpenAI 互換の HTTP サーバー（ポート 3972）として動作し、OpenClaw のリクエストを Gemini CLI 向けに変換します。

主な設計上の特徴は以下の通りです。

1. **Warm Standby Runner Pool**:
   `runner-pool.js` がサーバー起動と同時に Gemini CLI プロセス（`runner.js`）をバックグラウンドで1つ事前起動・待機させています。リクエスト受信時は IPC でプロンプトを渡すだけで即座に処理が始まるため、起動コストがゼロになり応答が始まるまでの待機時間がほぼ消滅します。
2. **ハイブリッドランタイム構成**:
   アダプターサーバー (`src/server.js`) は **Node.js** で動作し、クライアント切断 (`res.on('close')`) を確実に検知します。Gemini CLI プロセス (`runner.js`) は高速起動のため **Bun** で動作します。
3. **システムプロンプトの中継**:
   OpenClaw が動的生成するコンテキストを抽出し、`GEMINI_SYSTEM_MD` 環境変数経由で Gemini CLI に渡します。


## 制限事項・トラブルシューティング

*   **APIの利用制限 (Rate Limit)**: 無料のGemini API/Googleアカウントを利用している場合、短時間の過度なリクエストにより制限（429 Too Many Requests）に引っかかる場合があります。
*   **認証の有効期限**: Gemini CLIのログインセッションが切れた場合は、再度当該ディレクトリ（`openclaw-gemini-cli-adapter`内）で `npx gemini login` を実行して再認証を行ってください。
*   **使用不能なツールと理由**: 以下のツールは現在、競合回避や構成上の制約により除外されています。
    *   **ファイル操作・実行系 (`read`, `write`, `edit`, `exec`, `bash`, `process`)**: Gemini CLI 標準ツール（ホスト権限）と機能が重複し、名称が競合するため除外されています。
    *   **ヒント**: Gemini 標準の `google_web_search` は、検索からページ閲覧（グラウンディング）までを一括で行えるため、OpenClaw の `web_search` / `web_fetch` の多くを強力に代替できます。

## 開発ロードマップ (Roadmap)

現在、このアダプタはリアルタイムストリーミング・ツール統合・ストップ機能を含むコア機能が安定稼働しています。未着手の課題や改善案については [backlog.md](docs/openclaw_geminicli_integration/openclaw_geminicli_integration/backlog.md) を参照してください。

今後の主な改修として以下を計画しています。

*   **マルチセッションでの高度なコンテキスト剪定 (Pruning):**
    トークン上限に達した際の履歴のガベージコレクションについて、Gemini CLI側の履歴とOpenClaw側のコンテキストのズレを完璧に同期するための高度な状態管理。
*   **Windows 対応 (`start.bat` の作成):**
    現在はUnix系の `start.sh` のみ提供。Windows環境での完全なポータビリティ実現を計画中。

## 免責事項

本ソフトウェアはコミュニティによる非公式のアダプタであり、Google社とは一切関係ありません。Gemini CLI および関連するGoogleアカウントの使用は、ユーザー自身の責任において行ってください。本ソフトウェアの使用によって生じたアカウントの停止、データの損失、その他の損害について、作者は一切の責任を負いません。本ソフトウェアは「現状のまま」提供され、いかなる保証もありません。

## アンインストール

このアダプタを削除して元のOpenClawの状態に戻すには以下の手順を行ってください。

1. `~/.openclaw/openclaw.json` を開き、`models.primary` を元の値（例: `anthropic-messages/claude-sonnet-3-5` など）に戻します。
2. `openclaw.json` の `cliBackends` に追加された `"gemini-adapter"` のブロックを削除します。
3. リポジトリフォルダ (`openclaw-gemini-cli-adapter`) を削除します。システム全体（グローバル）への影響は一切残らず、クリーンに削除されます。
