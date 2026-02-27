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
    2) LANG_CODE="ja" ;;
    3) LANG_CODE="zh" ;;
    *) LANG_CODE="en" ;;
esac

# ==============================================================================
# Multi-language messages
# ==============================================================================
if [ "$LANG_CODE" = "ja" ]; then
    MSG_HEADER="OpenClaw Gemini Gateway 自動インストーラー"
    MSG_ENV_CHECK="お使いの環境をチェックしています..."
    MSG_NODE_FOUND="  ✓ Node.js が見つかりました："
    MSG_NODE_MISSING="  ✗ Node.js が見つかりません → インストール時に自動でセットアップされます"
    MSG_BUN_FOUND="  ✓ Bun が見つかりました："
    MSG_BUN_MISSING="  ○ Bun は未インストール → Node.js で動作します（後から追加も可能）"
    MSG_INTRO_HEADER="以下のソフトウェアがインストール・設定されます："
    MSG_INTRO_BODY="
  1. OpenClaw 本体（AI エージェントのゲートウェイ）
     - Telegram / WhatsApp などのメッセンジャーに対応
     - プロセス: Node.js、ポート 18789

  2. Gemini CLI アダプタ（本ツール）
     - OpenClaw から Gemini CLI へのリクエストを仲介
     - プロセス: Node.js、ポート 3972

  【起動後の構成イメージ】
    あなた（Telegram）
         ↓
    OpenClaw Gateway（ポート: 18789）
         ↓ OpenAI互換 API
    Gemini CLI アダプタ（ポート: 3972）
         ↓ サブプロセス
    Gemini CLI → Google Gemini API（クラウド）

  【認証について】
    Gemini API の認証情報はこのアダプタフォルダ内（src/.gemini）に
    隔離して保存されます。既存の Gemini CLI 設定には影響しません。"

    MSG_WARN_HEADER="⚠  重要な注意事項 ⚠"
    MSG_WARN_BODY="
  ● このソフトウェアは現在ベータ版です。
  ● デフォルトで「YOLO モード」が有効です。

  YOLO モードとは：
    Gemini CLI が「ファイルの作成・編集・削除」「コマンドの実行」などの
    操作を、確認なしに自動で行うモードです。

  以下のような環境では絶対に実行しないでください：
    ✗ 重要な業務データ・本番環境サーバー
    ✗ 破壊的な変更が許されないシステム
    ✗ 不特定多数がアクセスできる共有サーバー

  必ず：
    ✓ テスト環境または専用の隔離環境で動かしてください
    ✓ 実行ログを定期的に確認してください"

    MSG_CONFIRM="上記の内容をすべて確認し、了承しますか？ [Y/n]"
    MSG_ABORT="インストールを中止しました。"
    MSG_INSTALLING_NODE="NVM と最新の Node.js (LTS) をインストールしています..."
    MSG_NODE_DONE="✓ Node.js のセットアップが完了しました："
    MSG_BUN_OFFER="[オプション] Bun をインストールすると Gemini CLI の起動が約2倍高速になります。インストールしますか？ [Y/n]"
    MSG_BUN_INSTALLING="Bun をインストールしています..."
    MSG_BUN_DONE="✓ Bun のセットアップが完了しました："
    MSG_BUN_SKIP="  スキップしました。Node.js で動作します。"
    MSG_SETUP_START="セットアップを実行しています。しばらくお待ちください..."

elif [ "$LANG_CODE" = "zh" ]; then
    MSG_HEADER="OpenClaw Gemini Gateway 自动安装程序"
    MSG_ENV_CHECK="正在检查您的环境..."
    MSG_NODE_FOUND="  ✓ 找到 Node.js："
    MSG_NODE_MISSING="  ✗ 未找到 Node.js → 安装时会自动设置"
    MSG_BUN_FOUND="  ✓ 找到 Bun："
    MSG_BUN_MISSING="  ○ 未安装 Bun → 将使用 Node.js 运行（可稍后添加）"
    MSG_INTRO_HEADER="将安装和配置以下软件："
    MSG_INTRO_BODY="
  1. OpenClaw（AI 代理网关）
     - 支持 Telegram / WhatsApp 等信使
     - 进程: Node.js，端口 18789

  2. Gemini CLI 适配器（本工具）
     - 在 OpenClaw 和 Gemini CLI 之间中介请求
     - 进程: Node.js，端口 3972

  【启动后的架构】
    您（Telegram）
         ↓
    OpenClaw Gateway（端口: 18789）
         ↓ OpenAI 兼容 API
    Gemini CLI 适配器（端口: 3972）
         ↓ 子进程
    Gemini CLI → Google Gemini API（云端）

  【关于认证】
    Gemini API 认证信息保存在适配器文件夹内（src/.gemini），
    不会影响您现有的 Gemini CLI 设置。"

    MSG_WARN_HEADER="⚠  重要注意事项 ⚠"
    MSG_WARN_BODY="
  ● 本软件目前为测试版。
  ● 默认启用「YOLO 模式」。

  YOLO 模式是指：
    Gemini CLI 会自动执行「创建、编辑、删除文件」「运行命令」等操作，
    无需确认。

  请勿在以下环境中运行：
    ✗ 重要业务数据或生产服务器
    ✗ 不允许破坏性更改的系统
    ✗ 多用户共享服务器

  请确保：
    ✓ 在测试或隔离环境中运行
    ✓ 定期检查执行日志"

    MSG_CONFIRM="您是否已阅读并同意以上所有内容？ [Y/n]"
    MSG_ABORT="安装已取消。"
    MSG_INSTALLING_NODE="正在安装 NVM 和最新的 Node.js (LTS)..."
    MSG_NODE_DONE="✓ Node.js 设置完成："
    MSG_BUN_OFFER="[可选] 安装 Bun 可使 Gemini CLI 启动速度提升约2倍。是否安装？ [Y/n]"
    MSG_BUN_INSTALLING="正在安装 Bun..."
    MSG_BUN_DONE="✓ Bun 设置完成："
    MSG_BUN_SKIP="  已跳过。将使用 Node.js 运行。"
    MSG_SETUP_START="正在执行设置，请稍候..."

else  # English
    MSG_HEADER="OpenClaw Gemini Gateway Automated Installer"
    MSG_ENV_CHECK="Checking your environment..."
    MSG_NODE_FOUND="  ✓ Node.js found:"
    MSG_NODE_MISSING="  ✗ Node.js not found → Will be installed automatically"
    MSG_BUN_FOUND="  ✓ Bun found:"
    MSG_BUN_MISSING="  ○ Bun not installed → Will run on Node.js (can be added later)"
    MSG_INTRO_HEADER="The following software will be installed and configured:"
    MSG_INTRO_BODY="
  1. OpenClaw (AI Agent Gateway)
     - Supports Telegram / WhatsApp and other messengers
     - Process: Node.js, port 18789

  2. Gemini CLI Adapter (this tool)
     - Mediates requests between OpenClaw and Gemini CLI
     - Process: Node.js, port 3972

  [Architecture after setup]
    You (Telegram)
         ↓
    OpenClaw Gateway (Port: 18789)
         ↓ OpenAI-compatible API
    Gemini CLI Adapter (Port: 3972)
         ↓ Subprocess
    Gemini CLI → Google Gemini API (Cloud)

  [About authentication]
    Gemini API credentials are stored inside the adapter folder
    (src/.gemini) in isolation. Your existing Gemini CLI settings
    are not affected."

    MSG_WARN_HEADER="⚠  Important Notices ⚠"
    MSG_WARN_BODY="
  ● This software is currently in BETA.
  ● YOLO mode is enabled by default.

  What is YOLO mode?
    Gemini CLI will automatically create, edit, delete files and
    execute commands WITHOUT asking for confirmation.

  DO NOT run in the following environments:
    ✗ Critical business data or production servers
    ✗ Systems where destructive changes are unacceptable
    ✗ Shared servers accessible by multiple users

  Always:
    ✓ Run in a test or isolated environment
    ✓ Check execution logs regularly"

    MSG_CONFIRM="Have you read and do you agree to all of the above? [Y/n]"
    MSG_ABORT="Installation cancelled."
    MSG_INSTALLING_NODE="Installing NVM and the latest Node.js (LTS)..."
    MSG_NODE_DONE="✓ Node.js setup complete:"
    MSG_BUN_OFFER="[Optional] Installing Bun makes Gemini CLI start ~2x faster. Install? [Y/n]"
    MSG_BUN_INSTALLING="Installing Bun..."
    MSG_BUN_DONE="✓ Bun setup complete:"
    MSG_BUN_SKIP="  Skipped. Will run on Node.js."
    MSG_SETUP_START="Running setup, please wait..."
fi

# ==============================================================================
# 1. Header
# ==============================================================================
echo ""
echo "================================================="
echo " $MSG_HEADER"
echo "================================================="
echo ""

# ==============================================================================
# 2. Environment Check (informational, no prompts)
# ==============================================================================
echo "$MSG_ENV_CHECK"
echo ""

# Pre-load NVM if installed
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

NODE_MISSING=false
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "$MSG_NODE_FOUND $(node -v)"
else
    NODE_MISSING=true
    echo "$MSG_NODE_MISSING"
fi

if command -v bun >/dev/null 2>&1; then
    echo "$MSG_BUN_FOUND $(bun --version)"
else
    echo "$MSG_BUN_MISSING"
fi

# ==============================================================================
# 3. Show what will be installed
# ==============================================================================
echo ""
echo "-------------------------------------------------"
echo "$MSG_INTRO_HEADER"
echo "$MSG_INTRO_BODY"

# ==============================================================================
# 4. Show warnings
# ==============================================================================
echo ""
echo "-------------------------------------------------"
echo "$MSG_WARN_HEADER"
echo "$MSG_WARN_BODY"
echo "-------------------------------------------------"
echo ""

# ==============================================================================
# 5. Single confirmation prompt
# ==============================================================================
read -r -p "$MSG_CONFIRM " confirm
if [[ ! "$confirm" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
    echo "$MSG_ABORT"
    exit 0
fi
echo ""

# ==============================================================================
# 6. Install Node.js if missing
# ==============================================================================
if [ "$NODE_MISSING" = true ]; then
    echo "$MSG_INSTALLING_NODE"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
    fi
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
    echo "$MSG_NODE_DONE $(node -v)"
    echo ""
fi

# ==============================================================================
# 7. Offer Bun (optional, only if not already installed)
# ==============================================================================
if ! command -v bun >/dev/null 2>&1; then
    echo "$MSG_BUN_OFFER"
    read -r -p "> " install_bun
    if [[ "$install_bun" =~ ^([yY][eE][sS]|[yY]|)$ ]]; then
        echo "$MSG_BUN_INSTALLING"
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        echo "$MSG_BUN_DONE $(bun --version)"
    else
        echo "$MSG_BUN_SKIP"
    fi
    echo ""
fi

# ==============================================================================
# 8. Launch setup.js (fully automatic, no more prompts)
# ==============================================================================
echo "$MSG_SETUP_START"
echo ""
export SETUP_LANG="$LANG_CODE"
export SETUP_SKIP_INTRO="1"
if command -v bun >/dev/null 2>&1; then
    bun setup.js
else
    node setup.js
fi
