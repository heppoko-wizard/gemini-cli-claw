@echo off
chcp 65001 >nul
echo =================================================
echo  OpenClaw Gemini Gateway Automated Installer
echo =================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js がシステムに見つかりません。
    echo     winget を使用して自動的に Node.js (LTS) をインストールします...
    winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements
    
    echo.
    echo -------------------------------------------------
    echo ✓ Node.js のインストールプロセスが完了しました。
    echo 環境変数（PATH）をシステムに反映させるため、
    echo 一度このターミナルウィンドウを閉じて、新しく開き直してから
    echo 再度 install.bat を実行してください。
    echo -------------------------------------------------
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
    echo ✓ Node.js は既にインストールされています: %NODE_VER%
)

echo バックエンドのセットアップを開始します...
node setup.js
pause
