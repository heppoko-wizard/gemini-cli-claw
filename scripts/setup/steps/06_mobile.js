'use strict';

const QRCode = require('qrcode');
const { C, logBold, logSuccess, logDim, logInfo } = require('../utils/logger');
const { pressEnter, select } = require('../utils/prompt');
const https = require('https');

const APP_STORE_URL = "https://apps.apple.com/app/tailscale/id1475387142";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.tailscale.ipn";

async function generateQR(url, title) {
    try {
        logBold(`\n📱 ${title}`);
        logDim(`リンク: ${url}`);
        const qrString = await QRCode.toString(url, { type: 'terminal', small: true, margin: 2 });
        console.log(qrString);
    } catch (err) {
        logDim(`[QRコード生成スキップ: ${err.message}]`);
    }
}

async function waitAndCheckHttps(url) {
    process.stdout.write(`\n  ${C.cyan('⌛ HTTPS 接続の準備を確認中...')} `);
    let attempts = 0;
    const maxAttempts = 30;
    return new Promise((resolve) => {
        const check = () => {
            attempts++;
            https.get(url, { rejectUnauthorized: false }, (res) => {
                if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 401) {
                    process.stdout.write(`\n  ${C.green('✓ HTTPS 接続が確認されました。')}\n`);
                    resolve(true);
                } else {
                    retry();
                }
            }).on('error', () => {
                retry();
            });
        };
        const retry = () => {
            if (attempts >= maxAttempts) {
                process.stdout.write(`\n  ${C.yellow('⚠ HTTPS 接続の確認がタイムアウトしました。MagicDNS設定を確認してください。')}\n`);
                resolve(false);
            } else {
                process.stdout.write(C.dim('.'));
                setTimeout(check, 2000);
            }
        };
        check();
    });
}

module.exports = async function runStep() {
    const tailscaleIp = process.env.TAILSCALE_IP;
    const tailscaleHostname = process.env.TAILSCALE_HOSTNAME;

    // `01_config.js` の設定状態を確認
    const fs = require('fs');
    const { OPENCLAW_CONFIG } = require('../utils/docker-env');
    let isTailscaleServeEnabled = false;
    try {
        if (fs.existsSync(OPENCLAW_CONFIG)) {
            const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
            if (config.gateway && config.gateway.tailscale && config.gateway.tailscale.mode === 'serve') {
                isTailscaleServeEnabled = true;
            }
        }
    } catch (e) { }

    if (!isTailscaleServeEnabled || !tailscaleHostname) {
        return;
    }

    logBold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logBold('📲 モバイル連携ガイド (HTTPS)');
    logDim('スマホから安全にダッシュボードにアクセスするための手順をご案内します。');
    
    const choice = await select(
        ['ガイドを表示する', 'スキップする'],
        'モバイル連携のガイドを表示しますか？'
    );

    if (choice === 1) {
        logDim('モバイル連携ガイドをスキップしました。');
        return;
    }

    // 1. Tailscale App Installation Guide
    logBold('\n【ステップ1】 Tailscaleアプリのインストール');
    logDim('まだインストールしていない場合は、以下のQRからアプリをダウンロードしてください。');
    logDim('※ セットアップ時と同じGoogle/GitHub等のアカウントでログインしてください。');
    
    await generateQR(APP_STORE_URL, "iOS (iPhone/iPad) 向け");
    await generateQR(GOOGLE_PLAY_URL, "Android 向け");

    await pressEnter("インストールとログインが完了したら、Enterキーを押してください...");

    // 2. HTTPS Connection Verification
    const dashboardUrl = `https://${tailscaleHostname}/?token=openclaw-docker-session`;
    await waitAndCheckHttps(dashboardUrl);

    // 3. OpenClaw Dashboard Access QR
    logBold('\n【ステップ2】 OpenClawダッシュボードへアクセス');
    logDim('以下のQRコードをスマホのカメラでスキャンしてください。');
    logDim('セキュアなHTTPS接続により、パスワード不要で一発ログインできます！');
    
    await generateQR(dashboardUrl, "OpenClaw ダッシュボード (Auto-login)");

    logSuccess('\n✓ モバイル連携の準備が整いました。');
};
