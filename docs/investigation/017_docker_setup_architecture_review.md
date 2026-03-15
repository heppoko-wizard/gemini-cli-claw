# 調査報告書: Dockerハイブリッドセットアップの構造的崩壊と修正プラン

**調査方針（Strict-Investigator Rules Applicable）**  
本レポートは現在の `docker-install.sh` および `docker-setup.js` が、当初の「完全な隔離（Dockerハイブリッド）」という設計思想を満たしているかについての厳密な検証結果である。推測を排除し、コードの事実のみを列挙する。

## 1. 検出された致命的な矛盾・不具合（事実）

### 1-A. ホスト環境への Node.js 依存（致命度: 高）
*   **事実**: `docker-install.sh` のL55において、`node docker-setup.js` を実行し、ホストOSに直接 `node` コマンドが存在することを前提としている。
*   **影響**: 「Dockerさえあれば動く」という当初の設計思想に反し、真っ新なDebian/Ubuntu等の本番環境では `node: command not found` で即死する。

### 1-B. ホストOSの意図せぬ汚染（致命度: 高）
*   **事実**: `docker-setup.js` から呼び出される `03_gogcli.js`（L56）にて、`sudo sh -c 'curl ... | tar xz -C /usr/local/bin gog'` を実行している。
*   **影響**: 隔離環境を提供するはずのセットアップが、ユーザーのホストOSの `/usr/local/bin` を強制的に改変（汚染）している。

### 1-C. コンテナ環境（Runner）でのコマンド欠落（致命度: 高）
*   **事実**: `Dockerfile` に `gogcli` のインストール処理が存在しない。
*   **影響**: コンテナ起動後にOpenClaw（AI）がGoogle Workspace操作スキルを発動させようとしても、コンテナ内に `gog` バイナリが存在しないため、認証済みのトークンがあっても実行に100%失敗する。

### 1-D. スキル同梱の欠落とパスの不整合（致命度: 高）
*   **事実**: `03_gogcli.js`（L191）にて、`PROJECT_ROOT/skills/google-workspace-gogcli` をコピーしようとしているが、リポジトリ内に当該フォルダが存在しない。
*   **影響**: パッケージング（zip/tar）されたリリース版を別環境で展開した場合、上記のファイル不在によりエラーが発生し、Gemini CLIにGWS操作スキルが永久に渡されない。
*   **対処状態**: ※本調査の一環として、Antigravityシステム領域から当該スキル一式を `skills/google-workspace-gogcli/` へコピー（同梱復元）済みである。

---

## 2. 解決策（真のDocker専用セットアップ構造）

上記の崩壊状態を修正し、完全に設計思想に準拠させるための対応策。

### ① `Dockerfile` の更新
*   BuilderステージおよびRunnerステージに `gogcli` の取得・配置処理をハードコードし、コンテナ内でのコマンド実行を担保する。

### ② インストーラーとセットアップの境界再構築
*   **Tailscaleのホスト処理**: `04_tailscale.js` は廃止し、ホスト環境（ネットワークレベル）で必要なTailscaleのインストールと起動確認処理は、bashスクリプトである `docker-install.sh` 内に移行する。
*   **一時コンテナによるセットアップ実行**: `docker-install.sh` の終端において、Node.jsをホストに要求するのではなく、`docker run -it --rm --network host -v "$(pwd):/app" -w /app openclaw-adapter node docker-setup.js` のように、**自己ビルドしたコンテナ環境の中でセットアップオーケストレータを起動する**仕様へ変更する。
*   **ホスト汚染の根絶**: `03_gogcli.js` 内の `gogcli` バイナリのダウンロード処理など、ホストへ干渉するコードを全て削除する。

※ 上記の実装方針にユーザーの同意が得られ次第、直列でのコード修正フェーズに移行する。
