# メンテナンス・リスクレポート：アダプター全コード精査に基づく脆弱性と対策

本ドキュメントは、アダプターの全ソースコード（`src/*.js`）の網羅的精査に基づき、将来的な OpenClaw や Gemini CLI の仕様変更に際して「構造的に脆弱」な箇所を特定し、メンテナンス継続のための指針をまとめたものです。

---

## 1. 意味論的な脆弱性 (Semantic Risks)

### 1-1. 要約リクエストの検知ロジック
- **該当箇所**: `src/server.js:isSummarizationRequest()`
- **詳細**: `You are a context summarization assistant` というシステムプロンプトや `<conversation>` タグなどの文字列パターンに完全に依存しています。
- **リスク**: OpenClaw 側のプロンプト文言が 1 文字でも変わったり、XML 形式から JSON 形式へラップ方法が変更されると、検知に失敗します。
- **対策**: `analysis_target_openclaw_stable` 内の要約関連コードを定期的に grep し、アダプター側のマッチパターンと同期させる必要があります。

### 1-2. SSoT 4.0: ZWC デコード・リハイドレーションの依存
- **該当箇所**: `src/streaming.js:decodeZwc()`, `runGeminiStreaming()` 内のループ
- **詳細**: ステガノグラフィに使用するコード（`\u200B` 〜 `\u200D`）および、JSON 構造（`tool_use_pointer` 等のタイプ名）に依存しています。
- **リスク**: Gemini CLI 側で ZWC キャラクターの選定が変更されたり、アダプター側で保存している `logs/contexts/` のディレクトリ構造が変更されると、過去の回答を再読込（リハイドレート）できなくなります。
- **影響**: 会話の文脈が壊れ、LLM が過去のツール実行結果を正しく理解できなくなります。

---

## 2. 構造・環境的な脆弱性 (Structural Risks)

### 2-1. コンテキスト永続ストレージのディレクトリ構造
- **該当箇所**: `src/streaming.js` 内の `contextStoreDir` (`logs/contexts/${sessionKey}`)
- **詳細**: ツール実行の実データをファイルシステム上に `tool_use_${id}.json` という名前で保存しています。
- **リスク**: ストレージ上限やパーミッション変更、あるいは Docker ボリューム設定の変更により、この場所が書き込み不可になったり、データが消失すると情報の連鎖が途切れます。

### 2-2. 隔離環境 (GEMINI_CLI_HOME) の生成方法
- **該当箇所**: `src/streaming.js:prepareGeminiEnv()`, `src/runner-pool.js:prepareIsolatedGeminiHome()`
- **詳細**: セッションごとに一時的な `.gemini` ディレクトリを作成し、認証情報をコピーしています。
- **リスク**: Gemini CLI の設定ファイル（`settings.json`）のスキーマが変更された場合、MCP サーバの注入（`mcpServers` セクション）が失敗したり、バリデーションエラーで起動しなくなる可能性があります。

### 2-3. OS 依存のバイナリ解決
- **該当箇所**: `src/runner-pool.js:resolveNodeBin()`
- **詳細**: Node.js のパスを `which node` や特定のディレクトリ（`/usr/bin/node` 等）から自動解決しています。
- **リスク**: Docker イメージのベース OS が変更されたり、Node.js の管理方法（nvm 等）が変わると、Runner の事前起動ができなくなり、サーバーがハングします。

---

## 3. オーケストレーションの脆弱性 (Orchestration Risks)

### 3-1. IPC 通信プロトコル
- **該当箇所**: `src/runner-pool.js`, `src/runner.mjs`
- **詳細**: 親プロセス（Adapter）と子プロセス（Runner）の間で `{ type: 'ready' }`, `{ type: 'run' }` といった IPC 自作プロトコルを使用しています。
- **リスク**: Node.js の IPC 仕様変更や、アダプター側のメッセージハンドラでの例外によるゾンビプロセスの発生。

---

## 4. メンテナンスのための点検チェックリスト

以下のいずれかのイベントが発生した際は、本ドキュメントに基づきコードを点検してください。

- [ ] **OpenClaw のバージョンアップ**: `isSummarizationRequest` のマジックワードが有効か確認。
- [ ] **Gemini CLI のバージョンアップ**: `settings.json` のスキーマに変更がないか確認。
- [ ] **認証方式の変更**: `prepareGeminiEnv` でコピーしている認証ファイル名（`oauth_creds.json` 等）に変更がないか確認。
- [ ] **動作不安定時**: `logs/zwc_errors.log` を確認し、デコードエラーが多発していないかチェック。

---
**最終評価**: 本アダプターは「OpenClaw と Gemini CLI の間に入り込み、互いの期待するデータ構造へ変換する」という性質上、両者の UI/UX レイヤーの微細な変更に対して非常に敏感です。特に **"真実は外部にある"** という原則に基づき、データを極力持たない設計（ZWC ポインタ）にしていますが、その「ポインタを介した情報の再接続」こそが最大のメンテナンスポイントとなります。
