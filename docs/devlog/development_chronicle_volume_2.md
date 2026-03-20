# OpenClaw Gemini CLI Adapter - Development Chronicle (Volume 2)

## [2026-03-20] Session 53: 起動税ゼロの達成 — Persistent Runner (永続化ランナー) の実装

### やったこと
- **Persistent Runner アーキテクチャの実装**:
    - **課題**: リクエストごとに数MB〜数十MBのライブラリをロードする「起動税（約10-12秒）」を解消するため、ランナープロセスを常駐・再利用する設計へ移行。
    - **IPC プロトコルの拡張**: `runner.mjs` が処理完了時に `process.send({ type: 'run_complete' })` を送り、自ら終了せず次のリクエストを待機するように変更。
    - **Runner Pool の高度化**: `runner-pool.js` に `releaseRunner` メソッドを追加し、使用済みランナーをプールへ戻すライフサイクルを確立。
- **リソースリーク対策**:
    - プロセス再利用時にイベントリスナーが累積するのを防ぐため、`streaming.js` で名前付きハンドラ (`messageHandler`) を導入し、ストリーム終了時に確実に `removeListener` するロジックを実装。
    - `runner.mjs` 側でもモンキーパッチが多重適用されないようフラグによるガードを導入。

### 成果
- **レスポンス時間の劇的短縮**: 2回目以降のリクエストにおいて、10秒以上かかっていた初期化待ちがゼロになり、TTFT（最初のトークンが出るまでの時間）が数秒レベルまで高速化。

### 変更したファイル
- `src/runner.mjs` — IPC 通信の変更と多重初期化ガード。
- `src/streaming.js` — 永続ランナーのライフサイクル管理とリスナーのクリーンアップ。
- `src/runner-pool.js` — ランナーの再利用（Release）機能の実装。
- `docs/investigation/045_persistent_runner_architecture_report.md` — 最終アーキテクチャの記録。

---

## [2026-03-20] Session 54: Docker ビルド最適化と軽量・堅牢化

### やったこと
- **マルチステージビルドの導入**:
    - **課題**: ビルドツールの混入によるイメージの肥大化と、ホスト側の不要なファイル（`node_modules` やログ）がビルドコンテキストに含まれることによるメモリ不足・低速化を解消。
    - **実装**: `builder`（ネイティブビルド用）と `runtime`（軽量実行用）に分離。最終イメージを `node:24-bookworm-slim` ベースに刷新。
- **ビルド時間の高速化 (20分 -> 2分)**:
    - `.dockerignore` を大幅に強化し、ビルドコンテキストを最小化。
    - `npm ci` に `--omit=optional` を指定し、アダプターでは不要な `node-pty` 等の重いネイティブコンパイルを完全に排除。
    - グローバルパッケージ（`openclaw`）のインストールをソースコピー前に配置し、レイヤーキャッシュ率を最大化。
- **リソース制限と安定化**:
    - `docker-compose.yml` にメモリ上限（2GB）を設定。
    - `src/server.js` における巨大なリクエストログのディスク書き出しをデフォルトで抑制。
    - 不要になった Bun ランタイムを削除し、Node.js に一本化して予測可能性を向上。

### 成果
- ビルド時間を **20分超から約2分** へ短縮。
- イメージサイズを **約940MBから約316MB** へ約65%削減。
- メモリ不足によるビルド失敗や実行時の不安定さを抜本的に解決。

### 変更したファイル
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` — ビルド基盤の刷新。
- `src/server.js`, `start.sh` — デバッグ抑制とランタイムの Node 一本化。
- `docs/investigation/046_docker_optimization_report.md` — 最適化の詳細レポート。

---

## [2026-03-20] Session 55: 技術的負債のパージとコードの純化

### やったこと
- **デッドコードの物理的削除**:
    - **`server.js`**: 旧アーキテクチャで使われていた `sendFakeSummaryResponse`（ダミー要約応答）の巨大なコメントアウトを削除。
    - **`server.js`**: SSoT 5.1 時代の履歴クレンジング正規表現（`legacyToolLogRE`）を削除。現在は SSoT 6.x マーカー方式に完全移行しているため、不要な CPU 負荷を排除。
    - **`runner-pool.js`**: 使い捨てランナー時代の「寿命監視タイマー」の残骸を整理。
- **コードベースの軽量化**:
    - 機能を損なうことなく、不要な分岐や過去のハックを排除し、現在の Persistent Runner 構成に最適化。

### 成果
- コードの可読性が大幅に向上。
- 毎ターンのメッセージ処理における無駄な正規表現エンジンの起動を抑制し、微細なパフォーマンス向上を実現。

### 変更したファイル
- `src/server.js`, `src/runner-pool.js` — 不要コードの削除。
- `docs/investigation/047_tech_debt_and_deadcode_audit.md` — 負債の特定と処置の記録。

