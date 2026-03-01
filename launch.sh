#!/bin/bash
# OpenClaw と Gemini Adapter を一括起動し、コントロールダッシュボードを開くスクリプト

cd "$(dirname "$0")"

# Node.jsパスの解決 (ファイルマネージャー等からダブルクリック実行されたときのため)
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -f "$HOME/.profile" ] && source "$HOME/.profile" >/dev/null 2>&1 || true
    [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" >/dev/null 2>&1 || true
fi

echo "================================================="
echo " OpenClaw × Gemini Adapter 一括起動スクリプト"
echo "================================================="
echo ""

echo "[1/4] Gemini CLI アダプタを起動中..."
chmod +x start.sh 2>/dev/null || true
./start.sh

echo ""
echo "[2/4] UIアセットの確認中..."
cd ..
if [ ! -f "dist/control-ui/index.html" ]; then
    echo "⚠️  UIアセットが見つかりません。ビルドを開始します..."
    if command -v pnpm >/dev/null 2>&1; then
        pnpm ui:build
    elif command -v npm >/dev/null 2>&1; then
        npm run ui:build
    else
        echo "❌ エラー: pnpm/npm が見つかりません。UIビルドをスキップします。"
    fi
    if [ -f "dist/control-ui/index.html" ]; then
        echo "✓ UIビルドが完了しました。"
    else
        echo "⚠️  UIビルドが失敗したか、まだ完了していません。ダッシュボードが表示されない場合は 'pnpm ui:build' を手動実行してください。"
    fi
else
    echo "✓ UIアセット確認済み。"
fi

echo ""
echo "[3/4] OpenClaw Gatewayを起動中..."


# Gatewayの起動ログ用
GATEWAY_LOG="openclaw-gateway.log"

# ポート 18789 が空くのを待つ or 既に使用中か確認
if nc -z localhost 18789 2>/dev/null || lsof -i :18789 >/dev/null 2>&1; then
    echo "Gateway is already running on port 18789. (Skipping startup)"
else
    # Gatewayをバックグラウンドで起動 (gatewayコマンドを明示)
    nohup npm run openclaw -- gateway > "$GATEWAY_LOG" 2>&1 &
    GATEWAY_PID=$!
    echo "Gateway started (PID: $GATEWAY_PID)"
    echo "Gatewayの起動（およびセットアップ）を待機しています..."
    
    # 起動（ポートのリッスン）を確認するまでループ
    for i in {1..30}; do
        if nc -z localhost 18789 2>/dev/null; then
            echo "✓ Gateway is ready."
            break
        fi
        sleep 2
    done
fi

echo ""
echo "[4/4] ダッシュボードをブラウザで開きます..."
# dashboardコマンドを実行してURLを生成しブラウザを開く
npm run openclaw -- dashboard

echo ""
echo "================================================="
echo " 🎉 起動完了！"
echo " - アダプタログ: openclaw-gemini-cli-adapter/logs/adapter.log"
echo " - Gatewayログ: $GATEWAY_LOG"
echo ""
echo " ※ 終了させる場合は、以下のコマンドを実行してください："
echo "   kill \$(lsof -t -i :18789) 2>/dev/null || true"
echo "   kill \$(lsof -t -i :3972) 2>/dev/null || true"
echo "================================================="
