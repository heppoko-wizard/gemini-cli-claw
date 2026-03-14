#!/usr/bin/env node
/**
 * docker-setup.js — OpenClaw Gemini CLI Adapter (Docker Hybrid Setup)
 * モジュール化されたセットアップの各工程を順次呼び出すオーケストレーターです。
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { clear, logBold, logSuccess, logError, logWarn, logDim, C } = require('./scripts/setup/utils/logger');
const { PROJECT_ROOT } = require('./scripts/setup/utils/docker-env');
const { L } = require('./scripts/setup/utils/i18n');

async function main() {
    clear();

    // ==========================================
    // 1. 各セットアップステップの順次実行
    // ==========================================
    try {
        await require('./scripts/setup/steps/00_init')();
        await require('./scripts/setup/steps/01_config')();
        await require('./scripts/setup/steps/02_gemini')();
        await require('./scripts/setup/steps/03_gogcli')();
        await require('./scripts/setup/steps/05_workspace')();
    } catch (e) {
        logError('\n⚠ 致命的なエラーが発生し、セットアップが中断されました:');
        console.error(e);
        process.exit(1);
    }

    // ==========================================
    // 2. 完了
    // ==========================================
    logBold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logSuccess('設定の保存とワークスペースの構築が完了しました。');
    logDim('一時コンテナを終了し、本番コンテナを起動します...\n');
}

main().catch(err => {
    logError('\n⚠ 予期せぬエラーが発生しました:');
    console.error(err);
    process.exit(1);
});
