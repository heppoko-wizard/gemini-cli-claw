### 発見・学んだこと
- **構造化データのカプセル化**: 無理にプロトコル（SSE）を通じて構造化データを送ろうとせず、セッションを跨ぐ識別子（Marker ID）だけを共有し、実データの整合性はアダプター側で担保する「ステートフルな変換レイヤ」 の有効性を再確認した。

---

## [2026-03-16] Session 49: SSoT 6.1 — ツールコンテキストの永続化とビジネスロジックの堅牢化

### やったこと
- **SSoT 6.1: ツールコンテキストのファイル永続化の実装**
    - インメモリ Map (`toolContextStore`) の再起動耐性の欠如を課題として特定。
    - `/app/logs/contexts/{sessionKey}/{callId}.json` への即時フラッシュ・同期ロジックを実装。
    - アダプター再起動後も、ファイルからコンテキストをロードして履歴を完全復元（リハイドレート）できることを実証。

### 成果
- ツール実行のインターセプト回避（自律性）、履歴汚染の防止（知能バランス）、再起動耐性（堅牢性）の三権分立を達成。
- Gemini CLI が「自ら行った過去の作業」を、再起動を挟んでも完璧に理解し続けられる基盤が整った。

### 変更したファイル
- `src/streaming.js` — マーカー挿入、履歴リハイドレーション、ファイルベースの永続化の実装。
- `src/server.js` — 旧形式ログのクレンジング追加。
- `docker-compose.yml` — `/app/logs` マウント追加。
- `docs/investigation/035_ssot_6_architecture_design.md` — 最終アーキテクチャ設計。
- `docs/investigation/036_openclaw_intercept_mechanism_analysis.md` — インターセプト原理の解明。

---

## [2026-03-17] Session 50: WebUI 画像表示機能の実装と調査履歴のクレンジング

### やったこと
- **WebUI 画像表示機能の実装**:
    - **課題**: OpenClaw WebUI から送信される Base64 Data URI 形式の画像が、アダプター (`src/server.js`) でスキップされていたため、Gemini CLI に画像が渡っていなかった。
    - **解決策**: 新しいユーティリティ `src/media.js` を作成し、Base64 データのデコード、MIME タイプによる拡張子判定、一時ファイル (`/tmp/gemini-media-*`) への保存、およびログ出力機能を実装。
    - **統合**: `src/server.js` を修正し、`image_url` オブジェクト内の Data URI を検知した際に `media.js` を呼び出してデコード・保存し、その絶対パスを `mediaPaths` 配列に追加するようにした。
- **Gemini CLI 画像入力仕様の再確認**:
    - `src/runner.mjs` を調査し、`mediaPaths` に格納されたパスが `@` 構文で入力に注入され、同時に `WorkspaceContext` の `addReadOnlyPath` に自動登録される既存ロジックを再確認。これにより、追加の権限設定なしで 画像が Gemini に渡ることを担保した。
- **タグ問題の終結（ハルシネーションの特定）**:
    - 履歴に含まれていた `ctrl46` などの異常なタグおよび `⚙️ tooluse[name]{args}` 形式のマーカーについて徹底調査。
    - コードベースに生成ロジックが存在せず、また再現性もなかったことから、LLM による一時的な「履歴ハルシネーション」であると結論付け、調査を終了した。

### 発見・学んだこと
- **Gemini CLI (@google/gemini-cli) の設計意図**: `mediaPaths` を渡すだけで、セキュリティ上の制約も含めて処理してくれる `runner.mjs` の設計の堅牢さを再認識した。
- **偽情報の精査**: ログに現れた異常なタグであっても、それがコードから生成されたものか、モデルの出力によるものかを慎重に切り分けることの重要性を学んだ。

### 変更したファイル
- `src/media.js` — 新規作成：Base64 画像のデコード and 一時保存。
- `src/server.js` — Base64 データのパース and `media.js` の統合。
- `docs/investigation/037_webui_image_handling_investigation.md` — 調査報告書。
- `docs/investigation/033_history_normalization_failure_analysis.md` — 調査終了（ハルシネーション判定）の記録。

---

## [2026-03-17] Session 51: TTFT遅延（22秒）の根本解決とSSoT 6.4 ハイブリッドDTOパターンの確立

### やったこと
- **TTFT遅延（再初期化税）の特定と分析**:
    - **課題**: ウォームアップ機能が働かず、TTFTが常に22秒を超えていた問題を調査。
    - **真因**: `src/runner.mjs` 受信時の `Object.assign(process.env, env)` により、事前構築された `GEMINI_CLI_HOME` が破壊され、Gemini CLIが毎回重い再初期化（約12秒）を実行していた。
- **SSoT 6.4 ハイブリッドDTOパターンの設計と実装**:
    - **プロトコル刷新**: `server.js`, `streaming.js` から `...process.env` の送信を廃止。
    - **DTO化**: 必要なコンテキスト（`systemMdPath`, `sessionKey`）のみを明示的なオブジェクトとして伝播させる構造へ刷新。
    - **自己注入**: `runner.mjs` でグローバル上書きを廃止し、コアライブラリが必要とする最小限の変数のみをピンポイントで代入。これにより隔離環境（`GEMINI_CLI_HOME`）の100%保護を達成。
- **Docker環境の整合性復旧**:
    - **課題**: コンテナ内のコードが古いイメージに固定されており、ホスト側の修正が反映されていなかった。
    - **対応**: ソースディレクトリのマウント設定を正常化し、修正コードが確実にコンテナ内で動作する環境を再構築。

### 成果
- **起動税ゼロの奪還**: 環境変数汚染による再初期化を封じ込め、TTFTを理論値（10秒以下）へ改善するための構造的基盤を完成。
- **疎結合アーキテクチャへの昇華**: 環境変数という不透明な状態に頼らず、明示的なデータ（DTO）で制御する堅牢な通信プロトコルを確立。

### 変更したファイル
- `src/server.js`, `src/streaming.js`, `src/runner-pool.js` — 通信プロトコルのDTO化。
- `src/runner.mjs` — `Object.assign` の削除と環境変数のピンポイント注入。
- `docker-compose.yml` — マウント設定の正常化（開発環境）。
- `docs/investigation/040_performance_analysis_report.md.resolved` — 根本原因から解決策までの全記録。
- `docs/proposals/001-003` — 修正計画のトレードオフ議論。
