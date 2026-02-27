#!/bin/bash
set -e

# ==============================================================================
# 0. Language Selection
# ==============================================================================
echo "Select language / 言語選択 / 选择语言:"
echo "[1] English"
echo "[2] 日本語"
echo "[3] 简体中文"
read -r -p "> " lang_choice

case "$lang_choice" in
    2)
        MSG_HEADER="OpenClaw Gemini Gateway 自動インストーラー"
        MSG_NODE_FOUND="✓ Node.js は既にインストールされています:"
        MSG_NODE_NOT_FOUND="[!] Node.js がシステムに見つかりません。NVM で自動インストールしますか？ [Y/n]"
        MSG_NODE_INSTALLING="NVM と最新の Node.js (LTS) をインストールしています..."
        MSG_NODE_DONE="✓ Node.js のインストールが完了しました:"
        MSG_NODE_ABORT="手動で Node.js v22 以上をインストールしてから再実行してください。"
        MSG_BUN_FOUND="✓ Bun は既にインストールされています:"
        MSG_BUN_OFFER="[オプション] Bun をインストールすると Gemini CLI の起動が約2倍高速になります。インストールしますか？ [Y/n]"
        MSG_BUN_INSTALLING="Bun をインストールしています..."
        MSG_BUN_DONE="✓ Bun のインストールが完了しました:"
        MSG_BUN_SKIP="スキップしました。Node.js で動作します。"
        MSG_SETUP_START="バックエンドのセットアップを開始します..."
        ;;
    3)
        MSG_HEADER="OpenClaw Gemini Gateway 自动安装程序"
        MSG_NODE_FOUND="✓ Node.js 已安装:"
        MSG_NODE_NOT_FOUND="[!] 未找到 Node.js。是否使用 NVM 自动安装？ [Y/n]"
        MSG_NODE_INSTALLING="正在安装 NVM 和最新的 Node.js (LTS)..."
        MSG_NODE_DONE="✓ Node.js 安装完成:"
        MSG_NODE_ABORT="请手动安装 Node.js v22 或更高版本后重试。"
        MSG_BUN_FOUND="✓ Bun 已安装:"
        MSG_BUN_OFFER="[可选] 安装 Bun 可使 Gemini CLI 启动速度提升约2倍。是否安装？ [Y/n]"
        MSG_BUN_INSTALLING="正在安装 Bun..."
        MSG_BUN_DONE="✓ Bun 安装完成:"
        MSG_BUN_SKIP="已跳过。将使用 Node.js 运行。"
        MSG_SETUP_START="开始后端设置..."
        ;;
    *)
        MSG_HEADER="OpenClaw Gemini Gateway Automated Installer"
        MSG_NODE_FOUND="✓ Node.js is already installed:"
        MSG_NODE_NOT_FOUND="[!] Node.js not found. Install automatically via NVM? [Y/n]"
        MSG_NODE_INSTALLING="Installing NVM and the latest Node.js (LTS)..."
        MSG_NODE_DONE="✓ Node.js installation complete:"
        MSG_NODE_ABORT="Please install Node.js v22+ manually and re-run."
        MSG_BUN_FOUND="✓ Bun is already installed:"
        MSG_BUN_OFFER="[Optional] Installing Bun makes Gemini CLI start ~2x faster. Install? [Y/n]"
        MSG_BUN_INSTALLING="Installing Bun..."
        MSG_BUN_DONE="✓ Bun installation complete:"
        MSG_BUN_SKIP="Skipped. Will run on Node.js."
        MSG_SETUP_START="Starting backend setup..."
        ;;
esac

echo "================================================="
echo " $MSG_HEADER"
echo "================================================="

# ==============================================================================
# 1. Ensure NVM / Node.js are available
# ==============================================================================

# Pre-load NVM if installed (fixes "node not found" on fresh shells)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Also add Bun to PATH if already installed
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "$MSG_NODE_FOUND $(node -v)"
else
    echo "$MSG_NODE_NOT_FOUND"
    read -r -p "> " install_node
    if [[ "$install_node" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
        echo "-------------------------------------------------"
        echo "$MSG_NODE_INSTALLING"
        if [ ! -s "$NVM_DIR/nvm.sh" ]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
        fi
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install --lts
        nvm use --lts
        echo "$MSG_NODE_DONE $(node -v)"
        echo "-------------------------------------------------"
    else
        echo "$MSG_NODE_ABORT"
        exit 1
    fi
fi

# ==============================================================================
# 2. Bun (optional, for faster Gemini CLI startup)
# ==============================================================================
echo ""
if command -v bun >/dev/null 2>&1; then
    echo "$MSG_BUN_FOUND $(bun --version)"
    echo "  → 🚀"
else
    echo "$MSG_BUN_OFFER"
    read -r -p "> " install_bun
    if [[ "$install_bun" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
        echo "$MSG_BUN_INSTALLING"
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        echo "$MSG_BUN_DONE $(bun --version)"
    else
        echo "  $MSG_BUN_SKIP"
    fi
fi

# ==============================================================================
# 3. Launch setup.js (pass language choice forward)
# ==============================================================================
echo ""
echo "$MSG_SETUP_START"
# Convert number to language code for setup.js
case "$lang_choice" in
    2) export SETUP_LANG="ja" ;;
    3) export SETUP_LANG="zh" ;;
    *) export SETUP_LANG="en" ;;
esac
if command -v bun >/dev/null 2>&1; then
    bun setup.js
else
    node setup.js
fi
