### 調査レポート：リポジトリ全体把握とドキュメント確認

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: 本リポジトリは OpenClaw と Gemini CLI を連携させるアダプターであり、複雑な Docker 構成と詳細な調査履歴（docs/）を持つ大規模なプロジェクトである。
- **検証**: `list_dir` によりルートおよび `docs/` の構造を確認する。
- **事実の発見**: ルートには多数の起動スクリプト（.sh, .js）があり、`docs/investigation/` には 50 以上の調査レポートが存在する。

【調査計画】
1. **リポジトリ構造の深掘り**: `src/` 配下を調査し、サーバー本体、ランナー、中継ロジックの所在を特定する。
2. **基本仕様の確認**: `README.md`, `AGENT.md`, `package.json` を読み、プロジェクトの目的と主要な依存関係を把握する。
3. **継続中の課題の特定**: 直近の調査レポート（`050_unified_launcher_gateway_startup_failure.md`, `051_message_not_responding_investigation.md`）を読み、現在直面している問題や未解決事項を確認する。
4. **ドキュメント体系の整理**: `docs/` 配下の各ディレクトリ（devlog, plans, failures 等）の役割を把握する。

【コードベース・仕様から確認された最終的な事実】
- **リポジトリの目的**: OpenClaw と Gemini CLI を連携させ、Gemini CLI を自律エージェントとして動作させるためのアダプター。
- **主要コンポーネント**:
    - `src/server.js`: エントリポイント。OpenAI 互換 API を提供する Node.js サーバー。
    - `src/runner-pool.js`: Gemini CLI プロセスを Warm Standby 状態で管理するプール。
    - `src/streaming.js`: レスポンスの SSE 変換と ZWC（ゼロ幅文字）によるメタデータ密輸。
    - `src/runner.mjs`: 個別の Gemini CLI 実行用ワーカー。
- **重要ドキュメント**:
    - `AGENT.md`: AI エージェント向けの「絶対の掟（ZWC を消さない、YOLO モードの維持等）」。
    - `docs/devlog/development_chronicle.md`: 開発の歴史と重要な設計決定（ADR）の記録。
    - `docs/investigation/`: 50件以上の詳細な調査レポート。
- **現在の問題点**: `docs/investigation/051_...` によると、`src/server.js` の L349 で `reqStart` が未定義（ReferenceError）となっており、リクエスト受信時にクラッシュしている。

【ドキュメント体系の整理】
- `docs/devlog/`: 日々の開発記録。
- `docs/investigation/`: 特定の問題やアーキテクチャに関する深い調査資料。
- `docs/plans/`: 実装計画書。
- `docs/failures/`: 過去の失敗と教訓（`learn-from-failures` スキルで参照）。
- `docs/decisions/`: アーキテクチャ決定記録。

---
※ 本レポートは事実の列挙です。この結果に基づき、Phase 3 の実装計画作成へ進んでよいか、ご指示をお願いします。
