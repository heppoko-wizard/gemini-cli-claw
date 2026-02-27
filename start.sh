#!/usr/bin/env bash
#
# start.sh — Gemini CLI Adapter サーバーの起動スクリプト
#
# 使い方: ./start.sh [--port 3972]
# OpenClaw起動前にこのスクリプトを実行してアダプタサーバーを立ち上げておく。
# Bunが利用可能な場合は自動的にBunランタイムを使用する（高速起動）。
#

set -euo pipefail

# Node.jsパスの解決 (非対話シェルから実行されたときのため)
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && set +u && \. "$NVM_DIR/nvm.sh" && set -u || true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${GEMINI_ADAPTER_PORT:-3972}"
LOG_FILE="${SCRIPT_DIR}/logs/adapter.log"
PID_FILE="${SCRIPT_DIR}/logs/adapter.pid"

# Gemini CLI のホームディレクトリをプラグインローカル（gemini-home）に設定
export GEMINI_CLI_HOME="${SCRIPT_DIR}/gemini-home"

# ランタイム選択: server.js は必ず Node.js を使用
# Bun の HTTP サーバーは req.on('close') が TCP 切断ではなく body 消費完了で発火するため、
# クライアント切断検知（Abort 機能）が正しく動作しない。
# Runner プロセスは runner-pool.js 内の spawn で Bun を使用する。
RUNTIME="node"
echo "[start.sh] Using Node.js runtime ($(node --version)) for server.js"

# 既に起動中か確認 (PID)
if [[ -f "$PID_FILE" ]]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[start.sh] Adapter already running (PID $OLD_PID) on port $PORT"
        exit 0
    else
        echo "[start.sh] Removing stale PID file"
        rm -f "$PID_FILE"
    fi
fi

# ポートの競合確認 (ゾンビプロセス等)
if nc -z localhost "$PORT" 2>/dev/null || lsof -i :"$PORT" >/dev/null 2>&1; then
    echo "[start.sh] Port $PORT is already in use by another process. Assuming adapter is already running."
    exit 0
fi

echo "[start.sh] Syncing models to OpenClaw config..."
$RUNTIME "$SCRIPT_DIR/scripts/update_models.mjs" || echo "[start.sh] Warning: Failed to sync models"

# Create logs directory if it doesn't exist
mkdir -p "$SCRIPT_DIR/logs"

echo "[start.sh] Starting Gemini CLI adapter on port $PORT ..."
nohup $RUNTIME "$SCRIPT_DIR/src/server.js" > "$LOG_FILE" 2>&1 &
ADAPTER_PID=$!
echo "$ADAPTER_PID" > "$PID_FILE"

# 起動確認
sleep 1
if kill -0 "$ADAPTER_PID" 2>/dev/null; then
    echo "[start.sh] ✅ Adapter started (PID $ADAPTER_PID), log: $LOG_FILE"
else
    echo "[start.sh] ❌ Adapter failed to start. Check: $LOG_FILE"
    cat "$LOG_FILE"
    exit 1
fi
