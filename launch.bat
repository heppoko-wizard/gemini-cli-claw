@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

echo =================================================
echo  OpenClaw × Gemini Adapter 一括起動スクリプト
echo =================================================
echo.

echo [1/4] Gemini CLI アダプタを起動中...
if not exist logs mkdir logs
set GEMINI_CLI_HOME=%~dp0gemini-home

netstat -ano | find "LISTENING" | find ":3972" >nul
if %errorlevel% equ 0 (
    echo Gemini CLI アダプタは既に起動しています。
) else (
    echo アダプタをバックグラウンドで起動します...
    start /B "" node src\server.js > logs\adapter.log 2>&1
)

echo.
echo [2/4] UIアセットの確認中...
cd ..
if not exist dist\control-ui\index.html (
    echo ⚠️  UIアセットが見つかりません。ビルドを試みます...
    where pnpm >nul 2>&1
    if %errorlevel% equ 0 (
        pnpm ui:build
    ) else (
        npm run ui:build
    )
    if exist dist\control-ui\index.html (
        echo ✓ UIビルドが完了しました。
    ) else (
        echo ⚠️  UIビルドが失敗しました。手動で pnpm ui:build を実行してください。
    )
) else (
    echo ✓ UIアセット確認済み。
)

echo.
echo [3/4] OpenClaw Gatewayを起動中...
netstat -ano | find "LISTENING" | find ":18789" >nul
if %errorlevel% equ 0 (
    echo OpenClaw Gatewayは既に起動しています。
) else (
    echo Gatewayをバックグラウンドで起動します...
    start "OpenClaw Gateway" /B cmd /c "npm run openclaw -- gateway > openclaw-gateway.log 2>&1"
    echo Gatewayの起動を待機しています...
    :wait_gateway
    timeout /t 2 /nobreak >nul
    netstat -ano | find "LISTENING" | find ":18789" >nul
    if %errorlevel% neq 0 (
        set /a retry_count+=1
        if %retry_count% lss 15 goto wait_gateway
    )
)

echo.
echo [4/4] ダッシュボードをブラウザで開きます...
npm run openclaw -- dashboard

echo.
echo =================================================
echo  🎉 起動処理が完了しました。
echo  - アダプタログ: openclaw-gemini-cli-adapter\logs\adapter.log
echo  - ダッシュボードがブラウザで開きました。
echo =================================================
pause
