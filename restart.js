#!/usr/bin/env node

/**
 * OpenClaw Gemini CLI Adapter - Restart Utility (Quick)
 * 
 * This script restarts the existing container without rebuilding.
 * Usage:
 *   node restart.js
 */

const { spawn } = require('child_process');
const http = require('http');

const CHECK_URL = 'http://localhost:18789';
const MAX_WAIT_SEC = 300; // 5 minutes

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function isServerReady() {
    return new Promise((resolve) => {
        const req = http.get(CHECK_URL, (res) => {
            // Dashboard available
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

async function main() {
    console.log('🔄 Quick Restarting OpenClaw Gemini CLI Adapter (no build)...');

    const child = spawn('docker', ['compose', 'up', '-d'], {
        stdio: 'inherit',
        shell: true
    });

    child.on('exit', async (code) => {
        if (code !== 0) {
            console.error(`\n❌ Restart failed with exit code ${code}`);
            process.exit(code);
        }

        console.log('\n⌛ Waiting for the server to stabilize...');

        let startTime = Date.now();
        let ready = false;
        let dots = '';

        while (Date.now() - startTime < MAX_WAIT_SEC * 1000) {
            ready = await isServerReady();
            if (ready) break;

            dots = dots.length > 5 ? '' : dots + '.';
            process.stdout.write(`\r   Booting${dots.padEnd(6)} [${Math.floor((Date.now() - startTime) / 1000)}s]`);
            await wait(2000);
        }

        if (ready) {
            console.log('\n\n✅ Server is UP and STABLE!');
            console.log(`🔗 Dashboard: ${CHECK_URL}`);
        } else {
            console.error('\n\n❌ Timeout: Server did not respond.');
        }
        process.exit(ready ? 0 : 1);
    });
}

main().catch(err => {
    console.error('\n❌ Unhandled error:', err);
    process.exit(1);
});
