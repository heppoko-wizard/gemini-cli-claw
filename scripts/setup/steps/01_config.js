'use strict';

const fs = require('fs');
const path = require('path');
const { C, logDim, logSuccess, logError, logInfo, logBold } = require('../utils/logger');
const { OPENCLAW_CONFIG, GEMINI_CREDS_DIR, PROJECT_ROOT } = require('../utils/docker-env');
const { select } = require('../utils/prompt');

module.exports = async function runStep() {
    const settingsDir = path.join(GEMINI_CREDS_DIR, '.gemini');
    const settingsPath = path.join(settingsDir, 'settings.json');
    const tailscaleIp = process.env.TAILSCALE_IP;
    const tailscaleHostname = process.env.TAILSCALE_HOSTNAME;

    // Tailscale リモートアクセスの確認
    let useTailscale = false;
    if (tailscaleIp) {
        const label = tailscaleHostname ? `${tailscaleIp} / ${tailscaleHostname}` : tailscaleIp;
        logBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logInfo(`Tailscale ネットワークを検出しました: ${label}`);
        const choice = await select(
            ['Tailscale Serve (HTTPS) を有効にする (推奨)', 'ローカルアクセスのみ (安全)'],
            `アクセスモードを選択してください:`
        );
        useTailscale = choice === 0;
    }

    process.stdout.write(`\n  ${C.dim('設定ファイルを生成・更新中...')} `);
    try {
        let config = {};
        fs.mkdirSync(path.dirname(OPENCLAW_CONFIG), { recursive: true });
        if (fs.existsSync(OPENCLAW_CONFIG)) {
            try { config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8')); } catch (e) { }
        }
        
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = 'gemini-adapter/auto-gemini-3';
        
        config.gateway = config.gateway || {};
        config.gateway.mode = 'local';
        config.gateway.auth = config.gateway.auth || {};

        if (useTailscale) {
            // 【黄金律】Tailscale Serve (HTTPS) 構成
            // validation.ts の validateGatewayTailscaleBind により、tailscale.mode="serve" 時は
            // bind="loopback" が必須。"custom" + "127.0.0.1" も通過するが、loopback が最短形。
            config.gateway.bind = 'loopback';
            config.gateway.auth.mode = 'none';

            config.gateway.tailscale = {
                mode: 'serve',
                resetOnExit: true
            };

            config.gateway.controlUi = config.gateway.controlUi || {};
            config.gateway.controlUi.allowedOrigins = ["*"]; // Tailscaleドメインを許容

        } else {
            config.gateway.bind = 'loopback';
            config.gateway.auth.mode = 'none';
            // Tailscale関連設定をクリーンアップ（存在する場合のみ）
            if (config.gateway.tailscale) delete config.gateway.tailscale;
            if (config.gateway.auth.token) delete config.gateway.auth.token;
            if (config.gateway.auth.allowTailscale) delete config.gateway.auth.allowTailscale;
        }

        fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));

        fs.mkdirSync(settingsDir, { recursive: true });
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { }
        }
        settings.model = settings.model || { name: 'auto-gemini-3' };
        settings.security = settings.security || { auth: { selectedType: 'oauth-personal' }, folderTrust: { enabled: false } };
        settings.tools = settings.tools || { sandbox: false };
        settings.context = settings.context || { includeDirectories: ['/workspace'] };
        settings.mcpServers = settings.mcpServers || {};
        settings.mcpServers["openclaw-tools"] = {
            "command": "node",
            "args": [path.join(PROJECT_ROOT, "mcp-server.mjs"), "mcp-default", "/workspace"],
            "trust": true
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        logSuccess('DONE');
    } catch (e) { logError('FAIL: ' + e.message); throw e; }
};
