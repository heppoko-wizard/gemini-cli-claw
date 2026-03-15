#!/usr/bin/env node

/**
 * Gemini CLI Wrapper for OpenClaw Adapter
 * 
 * Usage:
 *   node cli.js           (Interactive mode)
 *   node cli.js login     (Re-authenticate)
 *   node cli.js --help    (Show help)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- ⚙️ Environment Auto-Discovery ---
const projectRoot = __dirname;
const isDocker = fs.existsSync('/.dockerenv');
const containerName = 'openclaw-gemini-adapter';

/**
 * 実行環境に応じた最適な Gemini CLI のコマンド/パスを解決する
 */
function resolveGeminiExecutable() {
    if (isDocker) {
        // Docker 内部では Dockerfile で PATH が通っているはずだが、念のため絶対パスも考慮
        return 'gemini'; 
    }

    // ホスト側で実行されている場合、まず Docker コンテナが動いているか確認
    try {
        const running = execSync(`docker ps -q --filter name=${containerName}`, { encoding: 'utf-8' }).trim();
        if (running) return 'DOCKER_EXEC';
    } catch (_) {}

    // ローカルインストールパスの探索（フォールバック）
    const paths = [
        'gemini', // PATH にあれば優先
        path.join(projectRoot, 'node_modules', '.bin', 'gemini'),
        path.join(projectRoot, '..', 'node_modules', '.bin', 'gemini'),
    ];
    for (const p of paths) {
        try {
            if (p === 'gemini') {
                execSync('gemini --version', { stdio: 'ignore' });
                return 'gemini';
            }
            if (fs.existsSync(p)) return p;
        } catch (_) {}
    }
    return null;
}

const geminiExe = resolveGeminiExecutable();

// --- 🚀 Execution Logic ---
const args = process.argv.slice(2);

if (!geminiExe) {
    console.error('❌ Error: Gemini CLI (gemini command) not found.');
    console.log('Please ensure "npm install" is done or the Docker container is running.');
    process.exit(1);
}

if (geminiExe === 'DOCKER_EXEC') {
    console.log(`🐳 Detected running Docker container. Executing inside ${containerName}...`);
    // Docker 側の PATH 設定（再ビルド）が完了していなくても動くよう、絶対パスを指定
    spawn('docker', ['exec', '-it', containerName, '/app/node_modules/.bin/gemini', ...args], {
        stdio: 'inherit'
    }).on('exit', code => process.exit(code));
} else {
    // ローカルまたは Docker 内部での直接実行
    const geminiCliHome = process.env.GEMINI_CLI_HOME || path.join(projectRoot, 'gemini-home');
    const env = { ...process.env, GEMINI_CLI_HOME: geminiCliHome, FORCE_COLOR: '1' };
    
    spawn(geminiExe, args, {
        stdio: 'inherit',
        env: env,
        shell: true
    }).on('exit', code => process.exit(code));
}
