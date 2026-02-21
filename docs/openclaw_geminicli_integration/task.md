# OpenClaw × Gemini CLI 疎結合アダプタ（翻訳層） タスクリスト

## 調査フェーズ
- [x] OpenClaw / Gemini CLI のリポジトリクローンと初期調査
- [x] OpenClawの自律稼働構造（HeartbeatRunner, daemon, cliBackends）の解析
- [x] Gemini CLIのAgent/Scheduler/セッション構造の解析
- [x] アダプタ構成の実現可能性と限界の検証（動的プロンプト、Pruning同期）
- [x] **[NEW]** OpenClawの `cliBackends` の真の挙動の解析と、Gemini CLI側での `GEMINI_SYSTEM_MD` によるシステムプロンプト上書き機能の発見。
  - プロンプト翻訳層（アダプタスクリプト）が必要であるという結論に至った。

## 実装フェーズ
- [x] 実装計画v3（翻訳層アダプタ）の承認
- [x] ステップ1: 中継スクリプト（`gemini-openclaw-adapter.js`）の実装
  - [x] OpenClawから渡される標準入力（`<system>...</system>`）のパースと有用コンテキスト（パス、Heartbeat内容等）の抽出
  - [x] 抽出内容を元にした Gemini CLI用システムプロンプトの動的生成
  - [x] 生成した一時ファイルを `GEMINI_SYSTEM_MD` に指定して `gemini --resume` コマンドを実行
  - [x] 結果テキストをそのまま標準出力へ返す（JSONパースによる履歴連携機能付き）
- [x] ステップ3: OpenClawからのシステムプロンプト（コンテキスト）注入対応
  - [x] `openclaw.json` での `--system` 引数の追加と中継でのパース
  - [x] Gemini CLIへの動的情報の反映（現在時刻、ロール等の継承）
- [x] ステップ4: OpenClawの `cliBackends` にアダプタスクリプトを登録
- [x] ステップ4: 統合テストと動作検証
  - [x] CLIからのメッセージ送信を通じ、中継サーバーが正しく起動しGemini CLIからの応答を得られることを確認
- [x] ポータブル配置（`~/GoogleDrive_Sync/ai_tools/gemini-autocore/`）

## フェーズ2: 専用バックエンド化とスキル同期
- [x] ステップ1: 専用バックエンド環境の構築
  - [x] `openclaw/gemini-backend` ディレクトリの作成
  - [x] `@google/gemini-cli` のローカルインストール
- [x] ステップ2: 動的シンボリックリンク機構の追加
  - [x] アダプタでの `--allowed-skills` パース処理の実装
  - [x] 許可されたスキルのみへのシンボリックリンク生成処理の実装
  - [x] `GEMINI_SKILLS_DIR` 環境変数の設定
- [x] ステップ3: 設定ファイルの更新
  - [x] `~/.openclaw/openclaw.json` で新しいアダプタのパスと `--allowed-skills {allowedSkillsPaths}` を指定
- [x] ステップ4: 動作検証
  - [x] スクリプトの `chmod +x` や同期フォルダへの配置の完了
## フェーズ3: テンプレートエンジンの導入と自己最適化
- [x] ステップ1: プロンプトテンプレートの分離
  - [x] `adapter-template.md` の作成（置換対象の変数を定義）
  - [x] `adapter.js` からハードコードされたプロンプト文字列を削除し、ファイル読み込み＆プレースホルダ置換処理を実装
- [x] ステップ2: テンプレート自己最適化機能の仮説検証
  - [x] Gemini CLIに対してテンプレート自身を最適化する指示を与えるテスト
  - [x] 最適化プロセスの自動化・フックポイントの検討
- [x] ステップ3: テストと最終検証
  - [x] 切り出したテンプレートが従来通り機能するかテスト
  - [x] walkthrough.mdの更新

## フェーズ4: 各種トリガーにおけるプロンプト整合性の検証 (Complete)
- [x] ステップ1: 検証用デバッグログの仕込み
  - [x] `adapter.js` 側で、Gemini CLIに渡す最終的なプロンプト全体をファイルへダンプする処理を追加
  - [x] `cli-runner.ts` 側（あるいはログ）で、OpenClawが構築した元のコンテキスト（`{{PROVIDED_SYSTEM_PROMPT}}` の中身等）を確認
- [x] ステップ2: 3種類のトリガーのテスト実行
  - [x] 1. ユーザー入力（通常のコマンドライン実行等）によるテスト
  - [x] 2. Heartbeat トリガーによる実行テスト
  - [x] 3. Cronジョブ（Isolated Agent）による実行テスト
- [x] ステップ3: ログの比較と損失検証
  - [x] 元のプロンプトとアダプタ生成後のプロンプトを比較し、プレースホルダ置換に文脈の損失がないか確認
  - [x] 調査結果を報告

## フェーズ6: アダプタの最適化 (冗長なテンプレートの廃止)
- [x] ステップ1: `adapter.js` のリファクタリング
  - [x] `adapter-template.md` の読み込み処理を削除
  - [x] OpenClawから渡される `<system>...</system>` の中身をそのまま最終的なシステムプロンプトとして扱うようにロジックを簡素化
- [x] ステップ2: 冗長ファイルの削除
  - [x] 不要になった `adapter-template.md` を物理的に削除
- [x] ステップ3: 動作確認とドキュメント修正
  - [x] 正常にGemini CLIにプロンプトが渡るかテストを実行
  - [x] `walkthrough.md` 等のドキュメントを更新

## フェーズ7: プロジェクトのドキュメント化 (READMEの作成)
- [x] ステップ1: スキル `github-readme-guide` の確認
- [x] ステップ2: ガイドラインに沿った客観的かつ実用的な README.md の作成
- [x] ステップ3: ユーザーによるレビューと修正

## フェーズ8: MCP進捗通知とキャンセルの実装テスト
- [x] ステップ1: `mcp-server.mjs` に進捗通知とAbortControllerの実装を追加
- [x] ステップ2: Gemini CLIをターミナルで起動し、時間のかかるツールを呼び出して挙動を確認
- [x] ステップ3: Gemini CLI側の仕様制限の検証と結論のドキュメント化

## フェーズ5: 動的MCPサーバー自動生成アダプターの実装
- [x] ステップ1: `@modelcontextprotocol/sdk` の導入と基盤準備
  - [x] `gemini-backend` ディレクトリで `@modelcontextprotocol/sdk` の依存関係を確認・追加
- [x] ステップ2: `mcp-server.js`（独立したMCPサーバ起動スクリプト）の実装
  - [x] Node.jsのファイルとして新規作成
  - [x] `@modelcontextprotocol/sdk` を用いた標準入出力用サーバー構築
  - [x] `createOpenClawCodingTools` から動的にツール群を取得
  - [x] `ListToolsRequest` に対してMCP形式のツールスキーマへ動的マッピング
  - [x] `CallToolRequest` に対して元ツールの `execute(params)` へディスパッチ
- [x] ステップ3: `adapter.js` の改修
  - [x] Gemini CLI起動時に、`mcp-server.js` へ接続するための設定JSONを一時ファイルとして生成
  - [x] `gemini` 起動引数にMCPサーバの設定を追加して渡す
- [x] ステップ4: 検証とデバッグ
  - [x] Cronや通常呼び出しで、GeminiがOpenClawのツール（Discord送信やAgent呼び出し等）を認識し、正しく呼び出せるかテスト
