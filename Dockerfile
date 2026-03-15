# OpenClaw Gemini CLI Adapter - Heavy Duty Dockerfile (Single Stage)
#

# ==========================================
# The Unbreakable Environment
# ==========================================
FROM node:24-bookworm

# PID 1 ハング対策의 tini と、証明書/暗号・ネイティブビルド用ツール一式を確実に導入
# C++17対応のgcc, cmake, git, python3 は sqlite-vec や node-pty のコンパイルで必須
# Playwright等の依存ライブラリもフルイメージのためほぼ充足しているが、念のため基本的な共有ライブラリ(nss3等)も明記
# ※ WSL等の不安定なDockerネットワーク環境に対処するため、apt-getにリトライとフォールバック処理を付与して強行突破する
RUN apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout="20" -o Acquire::https::Timeout="20" || \
    (sleep 3 && apt-get update -o Acquire::Retries=5) && \
    apt-get install -y --no-install-recommends \
    tini \
    curl bash git openssh-client ca-certificates unzip \
    build-essential cmake make python3 gcc g++ \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# SSH鍵エラーを回避し、全てのGitフェッチをセキュアなHTTPSへ強制変換 (無人インストール時の必須設定)
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/

# Google Workspace操作用のgogcliバイナリを取得し、PATHが通る場所に配置 (バージョン固定)
RUN curl -fsSL "https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz" | tar xz -C /usr/local/bin gog

# Tailscale バイナリの導入 (OpenClaw native Serve 統合に必須)
RUN curl -fsSL https://tailscale.com/install.sh | sh

# 軽量プロセスマネージャー(Bun)環境構築
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# npm globalのパス固定と権限エラー回避（root環境下でのNVM誤作動防止）
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH="/root/.npm-global/bin:${PATH}"

# 【最重関門】ネイティブビルドを伴う最新版 OpenClaw (v2026.3.13) のグローバルインストール
RUN npm install -g openclaw@2026.3.13

WORKDIR /app

# アダプタパッケージ情報とソースの転送
COPY package*.json ./
RUN npm ci

COPY . .

# 実行権限の付与
RUN chmod +x start.sh launch.sh

# Docker隔離環境用プロパティ群
ENV PLUGIN_DIR=/app
ENV GEMINI_CLI_HOME=/root/.gemini
ENV OPENCLAW_CONFIG=/root/.openclaw/openclaw.json

EXPOSE 3972
EXPOSE 18789

# tini をPID 1として使用し、シグナルハンドリングのハング(OSへのKILL不可)を確実に防ぐ
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "start.sh"]
