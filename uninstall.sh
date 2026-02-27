#!/bin/bash

# =======================================
# OpenClaw Gemini CLI Adapter - Uninstall
# =======================================

echo ""
echo "=============================================================="
echo " Gemini CLI Adapter アンインストーラー"
echo "=============================================================="
echo ""
echo "OpenClawの設定ファイル (~/.openclaw/openclaw.json) から"
echo "Geminiアダプタの登録を解除します。"
echo ""
read -p "続行するにはEnterキーを押してください... (Ctrl+Cでキャンセル)"

CONFIG_FILE="$HOME/.openclaw/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[!] 設定ファイル $CONFIG_FILE が見つかりません。"
    echo "    アンインストール処理を中断します。"
    exit 1
fi

echo "-> $CONFIG_FILE のバックアップを作成中..."
cp "$CONFIG_FILE" "${CONFIG_FILE}.bak_uninstall_gemini"

echo "-> 設定ファイルからGeminiアダプタの登録を解除中..."
# Node.jsを使って安全にJSONを編集する
node -e "
    const fs = require('fs');
    const path = '$CONFIG_FILE';
    try {
        const raw = fs.readFileSync(path, 'utf8');
        const config = JSON.parse(raw);
        
        let changed = false;
        
        // Primaryモデルがgemini-adapterなら元に戻す（とりあえずanthropicの初期設定にする）
        if (config?.models?.primary && config.models.primary.startsWith('gemini-adapter')) {
            config.models.primary = 'anthropic-messages/claude-3-7-sonnet-latest';
            changed = true;
            console.log('   - models.primary を anthropic に戻しました。');
        }
        
        // cliBackendsからgemini-adapterを削除
        if (config?.cliBackends && config.cliBackends['gemini-adapter']) {
            delete config.cliBackends['gemini-adapter'];
            changed = true;
            console.log('   - cliBackends から gemini-adapter を削除しました。');
        }
        
        if (changed) {
            fs.writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
            console.log('   - 変更を保存しました。');
        } else {
            console.log('   - 変更可能なGemini設定が見つかりませんでした。');
        }
    } catch (e) {
        console.error('[!] JSONのパースまたは書き込みに失敗しました:', e.message);
        process.exit(1);
    }
"

echo ""
echo "=============================================================="
echo " アンインストール（設定の解除）が完了しました！"
echo "=============================================================="
echo "最後に、現在開いているこのアダプタフォルダ"
echo "  $(pwd)"
echo "をご自身でゴミ箱に捨てて削除してください。"
echo "これで環境から完全にクリーンアップされます。"
echo ""
read -p "Enterキーを押して終了..."
