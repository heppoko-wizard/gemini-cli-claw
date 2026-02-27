@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

echo =================================================
echo  OpenClaw × Gemini Adapter 一括起動スクリプト
echo =================================================
echo.

echo [1/3] Gemini CLI アダプタを起動中...
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
echo [2/3] OpenClaw Gatewayを起動中...
cd ..
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
echo [3/3] ダッシュボードをブラウザで開きます...
npm run openclaw -- dashboard

echo.
echo =================================================
echo  🎉 起動処理が完了しました。
echo  - アダプタログ: openclaw-gemini-cli-adapter\logs\adapter.log
echo  - ダッシュボードがブラウザで開きました。
echo =================================================
pause
