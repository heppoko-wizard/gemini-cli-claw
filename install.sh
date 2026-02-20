#!/bin/bash
set -e

echo "================================================="
echo " OpenClaw Gemini Gateway Automated Installer"
echo "================================================="

# Node.js および npm の存在チェック
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[!] Node.js がシステムに見つかりません。"
    echo "    OpenClaw と Gemini CLI を実行するために Node.js が必要です。"
    echo "    NVM (Node Version Manager) を使って自動的に Node.js をインストールしますか？ [Y/n]"
    read -r -p "> " install_node
    if [[ "$install_node" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
        echo "-------------------------------------------------"
        echo "NVMと最新のNode.js (LTS) をインストールしています..."
        export NVM_DIR="$HOME/.nvm"
        if [ ! -s "$NVM_DIR/nvm.sh" ]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
        fi
        # NVMを現在のシェルセッションに読み込む
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        
        nvm install --lts
        nvm use --lts
        echo "✓ Node.js のインストールが完了しました: $(node -v)"
        echo "-------------------------------------------------"
    else
        echo "インストールを中止しました。手動で Node.js v18 以上をインストールしてから再実行してください。"
        exit 1
    fi
else
    echo "✓ Node.js は既にインストールされています: $(node -v)"
fi

# 対話型 setup.js の呼び出し
echo "バックエンドのセットアップを開始します..."
node setup.js
