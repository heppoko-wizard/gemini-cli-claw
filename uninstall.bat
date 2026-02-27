@echo off
setlocal

:: =======================================
:: OpenClaw Gemini CLI Adapter - Uninstall
:: =======================================

echo.
echo ==============================================================
echo  Gemini CLI Adapter アンインストーラー
echo ==============================================================
echo.
echo OpenClawの設定ファイル (~\.openclaw\openclaw.json) から
echo Geminiアダプタの登録を解除します。
echo.
pause

set "CONFIG_FILE=%USERPROFILE%\.openclaw\openclaw.json"

if not exist "%CONFIG_FILE%" (
    echo [!] 設定ファイル %CONFIG_FILE% が見つかりません。
    echo     アンインストール処理を中断します。
    echo.
    pause
    exit /b 1
)

echo -^> %CONFIG_FILE% のバックアップを作成中...
copy "%CONFIG_FILE%" "%CONFIG_FILE%.bak_uninstall_gemini" >nul

echo -^> 設定ファイルからGeminiアダプタの登録を解除中...
:: Node.jsを使って安全にJSONを編集する
node -e ^"const fs = require('fs'); const path = '%CONFIG_FILE%'.replace(/\\/g, '\\\\'); try { const raw = fs.readFileSync(path, 'utf8'); const config = JSON.parse(raw); let changed = false; if (config?.models?.primary ^&^& config.models.primary.startsWith('gemini-adapter')) { config.models.primary = 'anthropic-messages/claude-3-7-sonnet-latest'; changed = true; console.log('   - models.primary を anthropic に戻しました。'); } if (config?.cliBackends ^&^& config.cliBackends['gemini-adapter']) { delete config.cliBackends['gemini-adapter']; changed = true; console.log('   - cliBackends から gemini-adapter を削除しました。'); } if (changed) { fs.writeFileSync(path, JSON.stringify(config, null, 2), 'utf8'); console.log('   - 変更を保存しました。'); } else { console.log('   - 変更可能なGemini設定が見つかりませんでした。'); } } catch (e) { console.error('[!] JSONのパースまたは書き込みに失敗しました:', e.message); process.exit(1); }^"

echo.
echo ==============================================================
echo  アンインストール（設定の解除）が完了しました！
echo ==============================================================
echo 最後に、現在開いているこのアダプタフォルダ
echo   %CD%
echo をご自身でゴミ箱に捨てて（削除して）ください。
echo これで環境から完全にクリーンアップされます。
echo.
pause
