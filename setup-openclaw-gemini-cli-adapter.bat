@echo off
rem =============================================================================
rem setup-openclaw-gemini-cli-adapter.bat — OpenClaw × Gemini CLI Adapter ブートストラッパー
rem
rem このスクリプトは OpenClaw のルートフォルダに配置して実行します。
rem Node.js が無ければ winget で自動インストールし、interactive-setup.js を起動します。
rem =============================================================================
chcp 65001 >nul 2>&1
title OpenClaw Gemini CLI Setup
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "SCRIPT_DIR=%~dp0"
set "ADAPTER_DIR=%SCRIPT_DIR%openclaw-gemini-cli-adapter"

rem --- Node.js チェック ---
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo =================================================
    echo  Node.js が見つかりません。自動インストールします...
    echo  Node.js not found. Installing automatically...
    echo =================================================
    echo.
    winget install -e --id OpenJS.NodeJS.LTS
    echo.
    echo  インストール完了。ターミナルを再起動後、もう一度 setup-openclaw-gemini-cli-adapter.bat を実行してください。
    echo  Installation done. Please RESTART this terminal and run setup-openclaw-gemini-cli-adapter.bat again.
    pause
    exit /b 0
)

rem --- interactive-setup.js を探して起動 ---
set "SETUP_JS="
if exist "%SCRIPT_DIR%interactive-setup.js" (
    set "SETUP_JS=%SCRIPT_DIR%interactive-setup.js"
) else if exist "%ADAPTER_DIR%\interactive-setup.js" (
    set "SETUP_JS=%ADAPTER_DIR%\interactive-setup.js"
)

if not defined SETUP_JS (
    echo Error: interactive-setup.js not found.
    pause
    exit /b 1
)

node "!SETUP_JS!"
pause
