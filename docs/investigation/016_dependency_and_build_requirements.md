# 依存ツリー徹底調査および潜在的エラー要因分析レポート

本ドキュメントは、OpenClaw Gemini CLI Adapter を Docker 環境へ本番導入するにあたり、考えうるすべての依存関係とエラー要因（ビルド時・実行時）を完全に先回りして特定・排除するための調査結果である。いかなる環境でも「一発で通るヘビーデューティーな構成」を実現するための指針となる。

## 1. 依存ツリー分析 (npm info 解析結果)

`openclaw@2026.3.8` および `@google/gemini-cli` を中心とした深掘り調査の結果、以下の要注意依存関係（ネイティブアドオン、特殊な取得経路を持つパッケージ）が判明した。

### 1-A. ネイティブコンパイルを伴うモジュール
*   **`sqlite-vec` (0.1.7)**: SQLite 用のベクトル検索拡張機能。ソースからのコンパイルが必要になる場合が多く、C++17対応のコンパイラ (`gcc/g++`)、`cmake`、および `python3`（node-gyp用）を強く要求する。
*   **`@lydell/node-pty`**: ターミナルエミュレーション用のネイティブモジュール。コンパイルに `make` や `python3` が必須。

### 1-B. 特殊なシステム依存や巨大なバイナリ取得を伴うモジュール
*   **`playwright-core`**: ブラウザ自動化のためのコア。実行時に Chromium 等のブラウザバイナリをダウンロードし、さらに**ホストOS側に X11, NSS, ALSA, GStreamer などの膨大な共有ライブラリ(OS依存)** を要求する。`node:slim` などの軽量イメージでうかつに実行すると、ブラウザ起動時に共有ライブラリ不足（`libnss3.so: cannot open shared object file: No such file or directory` など）で 100% クラッシュする。
*   **`sharp` / `@napi-rs/canvas`**: 画像処理。事前にビルドされたバイナリがフェッチされる場合もあるが、一部環境ではフォント（`fontconfig`）や `libvips` などのライブラリを必要とする。
*   **`clipboardy`**: Linux環境下では `xclip` または `xsel` などのクリップボード管理ツールをOS側に要求する可能性がある。

---

## 2. 潜在的エラー要因の徹底洗い出しと先回り対策

### エラー要因 ①：ビルドツール不足による `npm install` 失敗
*   **原因**: `sqlite-vec` 等のビルド時に `node-gyp` が必要とする C++ コンパイラや Python3 がイメージに存在しない。
*   **完全対策**: Builder ステージにおいて、`build-essential`, `python3`, `cmake`, `make` の一式を確実にインストールする。

### エラー要因 ②：SSH 鍵・証明書不足による Git リポジトリフェッチ失敗
*   **原因**: まれに依存ツリー内で `git+ssh://` プロトコルによるリポジトリ取得が指定されていたり、証明書が古く HTTPS リクエストが失敗する場合がある。CIやDockerビルドなどの無人環境において、ここでプロンプトがハングしたり認証エラーで止まる。
*   **完全対策**: 
    1.  `ca-certificates` と `openssh-client` をインストールし最新化。
    2.  `git config --global url."https://github.com/".insteadOf ssh://git@github.com/` を仕込み、全ての SSH リクエストを安全な HTTPS へ強制変換して鍵認証を回避する。

### エラー要因 ③：軽量実行環境 (Runner) での Playwright 等のランタイムクラッシュ
*   **原因**: ビルドを通過しても、実際にコンテナ内（Runnerステージ: `node:*-slim`）で機能テストやWebブラウザ操作が走った瞬間、`playwright` が要求する共有ライブラリ（`libgtk-3-0`, `libnss3`, `libasound2` など）や `fontconfig` が入っていないため即死する。
*   **完全対策**: Runner ステージにおいて、「スリムさを保ちつつも、実際にAIがWebブラウジングなどを使い始めた際にクラッシュしないための厳選されたOSライブラリ」を一式（`npx playwright install-deps chromium` 相当）インストールする。

### エラー要因 ④：PID 1 問題 (Docker での Node.js シグナル無反応)
*   **原因**: Node.js アプリケーションを Docker の CMD で直接起動すると、PID 1 となり、OSからの終了シグナル (SIGTERM/SIGINT) を正常に受け取れず、終了時に必ずハングアップ・ゾンビプロセス化する。
*   **完全対策**: プロセス管理ツールである `tini` または `dumb-init` を Runner に導入し、これに PID 1 の役割を担わせる。

---

## 3. ヘビーデューティー版 Dockerfile アーキテクチャ提案

上記の分析に基づき、以下の「絶対に失敗しないマルチステージ構成」の Dockerfile を設計・提案する。

*   **Stage 1: The Heavy Builder**
    *   ベース: `node:24-bookworm` (フルパッケージ)
    *   措置: `git config` による SSH 鍵問題の回避、`python3` / `cmake` 等による完全なネイティブビルドの保証。
    *   処理: `npm install -g openclaw@2026.3.8` とアダプタ本体の `npm ci` の実行。
*   **Stage 2: The Bulletproof Runner**
    *   ベース: `node:24-bookworm-slim`
    *   措置: Playwright の要求する共有ライブラリを手動で最小限補完（`libnss3`, `libasound2`, `libatk-bridge2.0-0` 等）。
    *   措置: PID 1 ハングを防ぐための `tini` 導入。
    *   措置: GWS スキル対応のための `gogcli` バイナリ配置。
    *   処理: `/usr/local/bin/gog`, `openclaw` インストール済みディレクトリ、およびビルド済みの `/app` ディレクトリを Builder から引き継ぎ、安全な `tini -- bash start.sh` で起動する。

これにより、「一時しのぎのパッケージ追加」ではなく、AIフレームワークの挙動と仕様に最適化された究極の本番環境が実現される。
