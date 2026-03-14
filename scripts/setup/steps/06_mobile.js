'use strict';

const QRCode = require('qrcode');
const { C, logBold, logSuccess, logDim } = require('../utils/logger');
const { pressEnter, select } = require('../utils/prompt');

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

module.exports = async function runStep() {
    const tailscaleIp = process.env.TAILSCALE_IP;
    const tailscaleHostname = process.env.TAILSCALE_HOSTNAME;

    // リモートアクセスが有効化されていない（またはTailscaleが無い）場合はスキップ
    // 注: 01_config.js の設定結果に依存するが、ここでは環境変数の存在で簡易判定する。
    // より正確には openclaw.json の bind === 'tailnet' を見ても良い。
    if (!tailscaleIp) {
        return;
    }

    // `01_config.js` で「ローカルアクセスのみ」を選んだ場合、openclaw.json には bind: 'loopback' が設定される。
    // その状態を読み取ってスキップする処理を入れる。
    const fs = require('fs');
    const path = require('path');
    const { OPENCLAW_CONFIG } = require('../utils/docker-env');
    let isTailnetEnabled = false;
    try {
        if (fs.existsSync(OPENCLAW_CONFIG)) {
            const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
            if (config.gateway && config.gateway.bind === 'tailnet') {
                isTailnetEnabled = true;
            }
        }
    } catch (e) {
        // ignore
    }

    if (!isTailnetEnabled) {
        return;
    }

    logBold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logBold('📲 モバイル連携セットアップ (Tailscale)');
    logDim('スマホからダッシュボードにアクセスするための準備を行います。');
    
    const choice = await select(
        ['はい、設定する', 'スキップする'],
        'モバイル連携のガイドを表示しますか？'
    );

    if (choice === 1) {
        logDim('モバイル連携セットアップをスキップしました。');
        return;
    }

    // 1. Tailscale App Installation Guide
    logBold('\n【ステップ1】 Tailscaleアプリのインストール');
    logDim('まだインストールしていない場合は、以下のQRからアプリをダウンロードしてください。');
    logDim('※ セットアップ時と同じGoogle/GitHub等のアカウントでログインしてください。');
    
    await generateQR(APP_STORE_URL, "iOS (iPhone/iPad) 向け");
    await generateQR(GOOGLE_PLAY_URL, "Android 向け");

    await pressEnter("インストールとログインが完了したら、Enterキーを押してください...");

    // 2. OpenClaw Dashboard Access QR
    logBold('\n【ステップ2】 OpenClawダッシュボードへアクセス');
    
    // ホスト名(MagicDNS)があればそれを使用し、なければIPを使用
    const host = tailscaleHostname || tailscaleIp;
    const dashboardUrl = `http://${host}:18789?token=openclaw-docker-session`;

    logDim('以下のQRコードをスマホのカメラでスキャンすると、パスワード不要で一発ログインできます！');
    await generateQR(dashboardUrl, "OpenClaw ダッシュボード (Auto-login)");

    logSuccess('\n✓ モバイル連携のガイドが完了しました。');
};
