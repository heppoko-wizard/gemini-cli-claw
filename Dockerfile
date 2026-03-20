# ==========================================
# Phase 1: Builder (Native Compilations)
# ==========================================
FROM node:24-bookworm AS builder

# ネイティブビルドツールの導入
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake make python3 gcc g++ curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# gogcli バイナリの取得
RUN curl -fsSL "https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz" | tar xz -C /usr/local/bin gog

# アダプタパッケージ情報と依存関係のインストール（ネイティブビルドを含むが、不要なオプションは除外）
COPY package*.json ./
RUN npm ci --production --omit=optional

# ==========================================
# Phase 2: Runtime (Slim Execution Env)
# ==========================================
FROM node:24-bookworm-slim

WORKDIR /app

# 実行に必要な最小限のライブラリと tini
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini curl bash git openssh-client ca-certificates unzip \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# OpenClaw のインストール（コード変更の影響を受けないよう、ソースコピー前に実行してキャッシュを活用）
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH="/root/.npm-global/bin:${PATH}"
RUN npm install -g openclaw@2026.3.13 && npm cache clean --force

# Builder ステージから成果物をコピー
COPY --from=builder /usr/local/bin/gog /usr/local/bin/gog
COPY --from=builder /app/node_modules /app/node_modules

# アダプタソースの転送（.dockerignore により最小限に抑制）
COPY . .

# SSH鍵エラー回避設定
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/

# 実行権限の付与
RUN chmod +x start.sh launch.sh

# 環境変数の設定
ENV NODE_ENV=production
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH="/root/.npm-global/bin:/app/node_modules/.bin:${PATH}"
ENV PLUGIN_DIR=/app
ENV GEMINI_CLI_HOME=/root/.gemini
ENV OPENCLAW_CONFIG=/root/.openclaw/openclaw.json

EXPOSE 3972
EXPOSE 18789

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "start.sh"]
