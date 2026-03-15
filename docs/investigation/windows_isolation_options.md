### 調査レポート：Windows環境（WSL2/Dockerなし）での完全隔離実行の実現

#### 1. 調査計画 (Phase 1: Investigation Planning)

**背景と目的**:
本プロジェクトを、WSL2およびDockerが利用できないWindows環境において、外部への副作用を最小限に抑えた「完全隔離環境」で実行するための名案を調査・模索する。

**調査項目**:
1. **現状のアーキテクチャと依存関係の把握**:
    - `Dockerfile` および `docker-compose.yml` での環境構築内容の確認。
    - `package.json` の依存関係、特にネイティブアドオンの有無の確認。
    - `gog` バイナリやその他の外部ツールの役割と動作要件の確認。
2. **Windowsネイティブな隔離・パッケージング技術の調査**:
    - **Windows Containers (Process Isolation)**: Hyper-V不要なプロセス分離モードの要件と可搬性。
    - **ポータブルNode.js環境**: Node.jsランタイムと依存関係をパッケージ化し、レジストリや環境変数を汚さない実行方法（`nexe`, `pkg` など）。
    - **サンドボックス・仮想化技術**:
        - **Sandboxie-Plus**: アプリ専用の分離レイヤー。
        - **MSIX App Attach / App-V**: エンタープライズ向けのパッケージ仮想化（個人利用での現実味）。
        - **Windows Sandbox (WSB)**: 使い捨て環境としての利用、自動化の可否。
    - **WebAssembly (Wasm)**: Node.jsランタイム自体のWasm化や、サンドボックス実行環境（Wasmer, Wasmtime）。
3. **隔離の定義とトレードオフの整理**:
    - 「完全隔離」が指す範囲（ファイルシステム、ネットワーク、レジストリ、環境変数）の明確化。
    - ユーザーの利便性と隔離強度のバランス。

**調査手順**:
1. プロジェクト内の主要な設定ファイルとソースコードを読み込み、現在のDockerでの隔離内容を抽出する。
2. Windows環境でDockerなしでもファイルシステムや動作環境を独立させられる手法をウェブ検索および既存知識からリストアップする。
3. 各手法のメリット・デメリット（導入の容易さ、ポータビリティ、メンテナンス性）を比較する。

---
※ 以降、Phase 2 にて具体的な事実を記述します。

#### 2. 調査・レポート作成 (Phase 2: Fact Finding & Reporting)

### 調査レポート：依存環境の完全解明（OS・バイナリ・ライブラリ）

【調査の道筋】
- **目的**: アプリケーションを動かすために必要な「真の最小単位」を、OSレイヤーからライブラリレイヤーまで完全に特定する。
- **検証**: `Dockerfile` のインストールコマンド、`npm list --all` による依存ツリー、起動スクリプトの解析。
- **事実の発見**:

| カテゴリ | 依存対象 | 用途 | Windowsネイティブ時の代替・対応策 |
| :--- | :--- | :--- | :--- |
| **ランタイム** | Node.js 24 | メインサーバー (`server.js`) | Windows版 Node.js 24 (LTS) で対応可能 |
| | Bun | Runner (`runner-pool.js`) 高速起動用 | Windows版 Bun 1.1+ で対応可能 |
| **外部アプリ** | **OpenClaw (CLI)** | 最大のコア機能。Gateway/Agent機能 | WSL2不要なスタンドアロン実行の検証が必要 |
| | **gogcli** | Google Workspace (Gmail/Drive等) 操作 | Windows版 `gogcli.exe` が存在。PATH構成変更で対応 |
| | **Tailscale** | OpenClaw Native Serve 統合 | Windows版 Tailscale (Named Pipe) へのブリッジが必要 |
| **OSライブラリ** | `libnss3`, `libnspr4`等 | Playwright/Chromium (OpenClaw内) 依存 | Windows版の各種DLLが必要。通常はブラウザ同梱 |
| | `build-essential`, `python3` | ネイティブモジュールビルド | **最大の障壁**。Build Tools for Visual Studio が必要 |
| **Nodeネイティブ** | `node-pty` | ターミナルエミュレーション | Windows conpty を利用する Windows用バイナリが必要 |
| | `sqlite-vec` | ベクトル検索エンジン | `sqlite-vec-windows-x64` パッケージで対応可能 |
| **実行管理** | `tini` | PID 1 管理 (ゾンビプロセス防止) | Windowsでは不要。代わりにジョブオブジェクト等で管理検討 |

【特筆すべき依存構造】
1. **ネットワーク**: Dockerでは `network: host` を使用し、Tailscaleソケット (`/var/run/tailscale/tailscaled.sock`) を直接叩いている。Windowsではこれが `\\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled` のような名前付きパイプになるため、コードレベルの修正か、名前付きパイプをソケットにマッピングするリレーが必要。
2. **ファイルパス**: `GEMINI_CLI_HOME`, `OPENCLAW_CONFIG` などの環境変数でパスを固定しているが、Windowsでは `C:\Users\...` 形式へのポータブルな変換が必要。
3. **シェル依存**: `start.sh`, `launch.sh` が `bash` に依存。Windowsでは `PowerShell` への書き換え、あるいは `node` 自体で起動管理を行う必要がある。

【最終的な事実】
- 本アプリは単なるNode.jsアプリではなく、**「Linuxデスクトップ環境に近いスタック」**を要求している。
- 「完全隔離」を実現するには、これらの複雑なバイナリ群をひとつのディレクトリに閉じ込め、ホストのレジストリやシステムディレクトリに干渉させない「ポータブル環境構築」か「アプリ専用サンドボックス」が不可欠である。

---
※ 本レポートは事実の列挙です。この結果に基づき、Phase 3 の実装計画作成へ進んでよいか、ご指示をお願いします。
