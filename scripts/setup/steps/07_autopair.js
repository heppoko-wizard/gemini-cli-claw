'use strict';

const { spawnSync } = require('child_process');
const { C, logBold, logSuccess, logInfo, logWarn, logDim } = require('../utils/logger');
const { select } = require('../utils/prompt');

module.exports = async function runStep() {
    // Tailscaleが有効でない場合はスキップ
    const tailscaleHostname = process.env.TAILSCALE_HOSTNAME;
    if (!tailscaleHostname) return;

    logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logBold('🚀 自動デバイス承認モード (Auto-Pairing)');
    logDim('スマホや他デバイスからの初回アクセスを自動で承認します。');
    
    const choice = await select(
        ['今すぐ接続する (自動承認を開始)', 'あとで手動で設定する'],
        'デバイスを接続しますか？'
    );

    if (choice === 1) {
        logInfo('  自動承認をスキップしました。');
        return;
    }

    // ここで Promise を返さずに（ブロッキングせずに）バックグラウンドで処理を開始する
    logInfo('\n  自動承認モードをバックグラウンドで開始しました。');
    logWarn('  ※ セキュリティのため、この画面を閉じると自動承認は終了します。');

    let approvedCount = 0;
    const maxWait = 300; // 5分
    let elapsed = 0;

    const interval = setInterval(() => {
        elapsed += 2;

        // pending デバイスのリスト取得 (ホストからコンテナ内のopenclawを叩く)
        const listRes = spawnSync('docker', [
            'exec', 'openclaw-gemini-adapter', 
            'openclaw', 'devices', 'list', '--json', '--token', 'openclaw-docker-session'
        ]);
        
        if (listRes.status === 0) {
            try {
                const devices = JSON.parse(listRes.stdout.toString());
                // pending リストのみを対象とする（真の仕様）
                const pending = Array.isArray(devices.pending) ? devices.pending : [];

                for (const dev of pending) {
                    const reqId = dev.requestId;
                    const platform = dev.platform || 'Unknown OS';
                    const clientId = dev.clientId || 'Unknown Client';
                    
                    if (!reqId) continue; // Request IDがない場合はスキップ

                    process.stdout.write(`\n  ${C.green('✨ 新しいデバイスからのアクセスを検出:')} ${platform} (${clientId})\n`);
                    process.stdout.write(`  ${C.dim(`承認しています... (ReqID: ${reqId.substring(0,8)})`)}\n`);
                    
                    const appRes = spawnSync('docker', [
                        'exec', 'openclaw-gemini-adapter',
                        'openclaw', 'devices', 'approve', reqId, '--token', 'openclaw-docker-session'
                    ]);
                    
                    if (appRes.status === 0) {
                        process.stdout.write(`  ${C.green('✓ 承認に成功しました！')}\n`);
                        approvedCount++;
                    }
                }
            } catch (e) {
                // JSONパースエラー等は無視して次へ
            }
        }

        if (approvedCount > 0 || elapsed >= maxWait) {
            clearInterval(interval);
            if (approvedCount > 0) {
                process.stdout.write(`\n  ${C.bold(C.green('🎉 デバイスの接続が完了しました！'))}\n`);
            } else {
                process.stdout.write(`\n  ${C.yellow('⚠ タイムアウトしました。手動で承認が必要な場合があります。')}\n`);
            }
            // process.exit(0) を削除。clearInterval だけで十分。
            // setInterval が停止し、他に非同期タスクがなくなれば Node.js は自然終了する。
            // docker-install.sh L236 の .then() チェーンが継続して 06_mobile.js が実行される。
        }
    }, 2000);

    // すぐに resolve して、次の QR コード表示 (06_mobile.js) へ進ませる
    return Promise.resolve();
};
