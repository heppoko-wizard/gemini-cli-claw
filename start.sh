#!/usr/bin/env bash
#
# start.sh — Gemini CLI Adapter サーバーの起動スクリプト
#
# 使い方: ./start.sh [--port 3972]
# OpenClaw起動前にこのスクリプトを実行してアダプタサーバーを立ち上げておく。
# Bunが利用可能な場合は自動的にBunランタイムを使用する（高速起動）。
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${GEMINI_ADAPTER_PORT:-3972}"
LOG_FILE="${SCRIPT_DIR}/logs/adapter.log"
PID_FILE="${SCRIPT_DIR}/logs/adapter.pid"

# ランタイム選択: Bun優先、無ければNode.jsにフォールバック
if command -v bun >/dev/null 2>&1; then
    RUNTIME="bun"
    echo "[start.sh] 🚀 Using Bun runtime ($(bun --version))"
else
    RUNTIME="node"
    echo "[start.sh] Using Node.js runtime ($(node --version))"
fi

# 既に起動中か確認
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

echo "[start.sh] Syncing models to OpenClaw config..."
$RUNTIME "$SCRIPT_DIR/scripts/update_models.js" || echo "[start.sh] Warning: Failed to sync models"

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
