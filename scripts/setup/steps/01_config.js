'use strict';

const fs = require('fs');
const path = require('path');
const { C, logDim, logSuccess, logError } = require('../utils/logger');
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
        const choice = await select(
            ['Tailscale経由のリモートアクセスを許可 (推奨)', 'ローカルアクセスのみ (安全)'],
            `Tailscale ホスト (${label}) が検出されました。アクセスモードを選択してください:`
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
            config.gateway.bind = 'tailnet';
            config.gateway.auth.mode = 'token';
            config.gateway.auth.token = 'openclaw-docker-session';
            config.gateway.controlUi = config.gateway.controlUi || {};
            config.gateway.controlUi.allowedOrigins = config.gateway.controlUi.allowedOrigins || [];
            
            // IP アドレスとホスト名 (MagicDNS) の両方を許可リストに追加
            const origins = [];
            if (tailscaleIp) origins.push(`http://${tailscaleIp}:18789`);
            if (tailscaleHostname) {
                origins.push(`http://${tailscaleHostname}:18789`);
                origins.push(`https://${tailscaleHostname}`); // HTTPS (Tailscale HTTPS) 用
            }

            origins.forEach(origin => {
                if (!config.gateway.controlUi.allowedOrigins.includes(origin)) {
                    config.gateway.controlUi.allowedOrigins.push(origin);
                }
            });
        } else {
            config.gateway.bind = 'loopback';
            config.gateway.auth.mode = 'none';
            if (config.gateway.auth.token) delete config.gateway.auth.token;
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
