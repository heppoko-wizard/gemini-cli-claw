### 調査レポート：リポジトリ総合概要 (Comprehensive Repository Overview)

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: 本リポジトリは OpenClaw と Gemini CLI を連携させる高度なアダプターであり、歴史的な経緯（SSoT 2.0 -> 3.1 等）に基づいた独自の制約（ZWC, YOLO 等）が存在する。
- **検証**: Root, `src/`, `docs/` の全ファイルを走査し、`package.json`, `README.md`, `AGENT.md` および直近の調査レポート（050〜054）を精読した。
- **事実の発見**: 
    - **核心技術**: ストリーミングレスポンス内への ZWC (Zero Width Character) 埋め込みによるステガノグラフィ通信。
    - **プロセス管理**: 子プロセスの Warm Standby プール（`runner-pool.js`）による高速起動。
    - **現状の課題**: `server.js` のランタイムエラー、および MCP サーバーの初期化遅延（TTFT 改善策）が直近の焦点。
    - **進行中の計画**: 現在、ステートレスな DTO へのリファクタリング（Pattern C）が提案されている。

【コードベース・仕様から確認された最終的な事実】

#### 1. プロジェクトの目的と役割
- **正式名**: `openclaw-gemini-cli-adapter`
- **役割**: OpenClaw (OpenAI 互換 Gateway) と `@google/gemini-cli` の橋渡し。
- **動作フロー**: 
    1. OpenClaw から OpenAI 互換 API 形式でリクエストを受ける (`src/server.js`)。
    2. Runner プールから待機中のプロセスを取得し、モデルと履歴を注入する (`src/runner-pool.js`, `src/runner.mjs`)。
    3. Gemini API のストリーミング応答を SSE に変換しつつ、ツール実行結果などのメタデータを ZWC として埋め込んで返却する (`src/streaming.js`)。

#### 2. 主要ディレクトリ構造
- `src/`: システムの中核ロジック（サーバー、プール、ストリーミング、IPC）。
- `docs/investigation/`: 50件を超える詳細な調査履歴。**作業前に必ず連番の大きいものから順に目を通すこと。**
- `docs/proposals/`: 現在進行中の改善提案。
- `docs/failures/`: 過去の失敗から得た教訓。
- `gemini-home/`: Gemini CLI の隔離された実行環境（設定ファイル等）。

#### 3. AI エージェントのための「絶対厳守」事項 (from AGENT.md)
- **ZWC の保護**: レスポンスに含まれるゼロ幅文字をサニタイズしてはならない（履歴の喪失に繋がる）。
- **YOLO モードの維持**: エージェントの自律性を確保するため、サンドボックスを無効化し `--yolo` フラグで動作させる必要がある。
- **直接書き込みの禁止**: `.jsonl` 履歴ファイルへの直接編集は、フォーマット崩壊を招くため禁止。メモリ内の `resumedSessionData` で解決する。

#### 4. 直近の動向と課題
- **不具合**: `server.js` L349 における `reqStart` 未定義エラー（ReferenceError）の修正が必要。
- **最適化**: MCP サーバーの起動遅延（TTFT）を改善するため、`mcp-server-lightweight.mjs` への移行と「オフラインモード」の活用が進められている。
- **設計**: DTO (Data Transfer Object) を用いたステートレスな設計へのリファクタリングが提案されている (`003_fix_pattern_C...`)。

---
※ 本レポートは事実の列挙です。全容把握が完了したため、これを基に具体的な不具合修正や機能改善の Phase 3（実装計画）へ進むことが可能です。
