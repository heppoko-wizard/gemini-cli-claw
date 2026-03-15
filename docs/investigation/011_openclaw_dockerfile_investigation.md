# OpenClaw Dockerfile 依存関係およびエラー要因の徹底調査録

本書は、`openclaw` パッケージを Docker 環境（特にもともと軽量な `alpine` や `slim` イメージ）にグローバルインストールする際に発生する、あらゆるネイティブビルドエラーや特殊な依存解決エラーを根本的に排除するための事前調査レポートです。

## 1. 依存ツリーにおける「危険な（ネイティブ・特殊経路）」パッケージ群

`openclaw` は以下の重いネイティブモジュールや特殊な依存を抱えています。

### 1-1. `node-llama-cpp` (LLMローカル実行用モジュール)
- **要求事項**: 内部でC++のソースコード（llama.cpp）をコンパイルします。
- **必要なOSパッケージ**: `cmake`, `make`, `g++` (C++コンパイラ/build-essential), `python3`（ビルドスクリプト用）
- **過去のエラー**: Alpine Linuxでのビルド失敗（`glibc` 非互換および `cmake` 不足）。

### 1-2. `@whiskeysockets/baileys` -> `libsignal-node` (WhatsApp/Signal通信系)
- **要求事項**: npm レジストリからではなく、GitHub のリポジトリから**直接 Git を用いて**ソースを取得しようとします。デフォルトで SSH (`ssh://git@github.com/...`) を使用することがあります。
- **必要なOSパッケージ**: `git`, `openssh-client`, `ca-certificates`（ルート証明書）
- **過去のエラー**: 
  - Git 未インストールによるエラー
  - SSH クライアント未インストールによるエラー
  - SSH 鍵がないことによる「Permission denied (publickey)」
  - CA証明書不在によるHTTPS（URLすり替え後）の SSL 検証エラー

### 1-3. `@lydell/node-pty`, `sqlite-vec` 等 (ターミナル制御・DB等)
- **要求事項**: ネイティブアドオン (`node-gyp`) を用いて C++ コードをコンパイルします。
- **必要なOSパッケージ**: `python3`, `make`, `g++`
- **過去のエラー**: （今回は `node-llama-cpp` で先に落ちていましたが、軽量イメージでは確実に `python3` 不足等で落ちる運命にありました）

### 1-4. `bun` (ランナープロセスとして手動でインストール)
- **要求事項**: インストールスクリプト (`curl -fsSL https://bun.sh/install | bash`) の内部で、ダウンロードしたZIPを展開します。
- **必要なOSパッケージ**: `unzip`, `curl`, `bash`
- **過去のエラー**: `bookworm-slim` に変更した結果 `unzip` が削ぎ落とされており、ここでクラッシュ。

## 2. 場当たり的な修正（モグラ叩き）の反省

今までのアプローチは「軽量なイメージ (`node:24-alpine` や `node:24-bookworm-slim`) をベースとし、怒られたエラーのパッケージだけを一つ一つ追加する」という最悪のアンチパターンでした。

- SSH鍵エラーを `git config` ですり替えたことでHTTPSの証明書エラー(`ca-certificates`)を引き起こした。
- Alpine を Slim Debian に変えたことで、今度は `unzip` が消えてしまい `bun` のインストールが落ちた。

## 3. 解決策：一発で通る「ヘビーデューティー（堅牢）」な構成

以上の全エラー要因を**完全に先回りして潰す**ため、以下のアプローチを採用します。

1. **フルイメージの採用 (`node:24-bookworm`)**: 
   - `slim` ではなく、標準のフルパッケージ版を使用します。これにより、`python3`, `git`, `make`, `g++`, `unzip`, `ca-certificates`, `openssh-client` など、ビルドツールや証明書系のほぼ全てが**最初から確実に入っている状態**になります。イメージサイズは数GBに達しますが、安定性は抜群です。
2. **念のための追加ツール (`cmake`)**: 
   - `node:24-bookworm` にも `cmake` はデフォルトで入っていない可能性があるため、これのみ明示的にインストールします。
3. **Git SSH → HTTPS サニタイズ機構の維持**: 
   - 公開鍵が手元にないコンテナ環境での Git Clone 失敗を防ぐための `git config --global url."https://github.com/".insteadOf ssh://git@github.com/` は継続して採用します。

これらを適用した Dockerfile の設計により、将来的に `openclaw` がさらに理不尽な依存関係を追加してきたとしても、99%の確率でコンパイルを突破できる強力な基盤となります。
