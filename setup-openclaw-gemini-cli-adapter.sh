#!/bin/bash
# =============================================================================
# setup.sh — OpenClaw × Gemini CLI Adapter ブートストラッパー
#
# このスクリプトは OpenClaw のルートフォルダに配置して実行します。
# Node.js が無ければ自動インストールし、interactive-setup.js を起動します。
# すべての対話（言語選択・確認・認証）は interactive-setup.js 内で行います。
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER_DIR="$SCRIPT_DIR/openclaw-gemini-cli-adapter"

# Pre-load NVM / Bun if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

# --- Node.js が無い場合、自動インストール ---
if ! command -v node >/dev/null 2>&1; then
    echo ""
    echo "================================================="
    echo " Node.js が見つかりません。自動インストールします..."
    echo " Node.js not found. Installing automatically..."
    echo "================================================="
    echo ""
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    nvm install --lts
    nvm use --lts
    echo ""
    echo "  ✓ Node.js $(node -v) installed"
    echo ""
fi

# --- interactive-setup.js を探して起動 ---
SETUP_JS=""
if [ -f "$SCRIPT_DIR/interactive-setup.js" ]; then
    SETUP_JS="$SCRIPT_DIR/interactive-setup.js"
elif [ -f "$ADAPTER_DIR/interactive-setup.js" ]; then
    SETUP_JS="$ADAPTER_DIR/interactive-setup.js"
fi

if [ -z "$SETUP_JS" ]; then
    echo "Error: interactive-setup.js not found."
    exit 1
fi

# Bun があれば Bun で、なければ Node で起動
if command -v bun >/dev/null 2>&1; then
    exec bun "$SETUP_JS"
else
    exec node "$SETUP_JS"
fi
