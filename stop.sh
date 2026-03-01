#!/bin/bash

# ==============================================================
# OpenClaw Gemini CLI Adapter - Stop All Processes
# ==============================================================

echo "=============================================================="
echo " 全プロセスを終了しています..."
echo "=============================================================="

# 1. アダプターの PID ファイルがあればキル
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${SCRIPT_DIR}/logs/adapter.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    echo "-> アダプター (PID: $PID) を終了しています..."
    kill "$PID" 2>/dev/null
    rm "$PID_FILE"
fi

# 2. ポート 3972 (Adapter) を使用しているプロセスを念のためキル
ADAPTER_PID=$(lsof -t -i:3972 2>/dev/null)
if [ -n "$ADAPTER_PID" ]; then
    echo "-> ポート 3972 のプロセスを終了しています..."
    kill -9 $ADAPTER_PID 2>/dev/null
fi

# 3. ポート 18789 (Gateway) を使用しているプロセスをキル
GATEWAY_PID=$(lsof -t -i:18789 2>/dev/null)
if [ -n "$GATEWAY_PID" ]; then
    echo "-> OpenClaw Gateway (ポート 18789) を終了しています..."
    kill -9 $GATEWAY_PID 2>/dev/null
fi

# 4. ポート 19878 (Dashboard) を使用しているプロセスをキル
DASHBOARD_PID=$(lsof -t -i:19878 2>/dev/null)
if [ -n "$DASHBOARD_PID" ]; then
    echo "-> Dashboard (ポート 19878) を終了しています..."
    kill -9 $DASHBOARD_PID 2>/dev/null
fi

# 5. 残っている Runner (Bun) / Gemini CLI プロセスをキル
echo "-> 残存する Runner プロセスをクリーンアップ中..."
pkill -f "src/runner.js" 2>/dev/null
pkill -f "gemini-cli" 2>/dev/null

# 6. xclip や wl-copy のゾンビプロセスが残っていれば一掃
echo "-> クリップボードプロセス (xclip/wl-copy) をクリーンアップ中..."
pkill -f "xclip" 2>/dev/null
pkill -f "wl-copy" 2>/dev/null

echo ""
echo "=============================================================="
echo " ✓ すべてのプロセスを終了しました。"
echo "=============================================================="
