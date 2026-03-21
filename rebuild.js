#!/usr/bin/env node

/**
 * OpenClaw Gemini CLI Adapter - Rebuild & Restart Utility (Heavy Duty)
 * 
 * This script rebuilds (full Docker build), restarts, and WAITS for the server to be ready.
 * Usage:
 *   node rebuild.js
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
    console.log('🔄 Rebuilding & Restarting OpenClaw Gemini CLI Adapter...');

    const child = spawn('docker', ['compose', 'up', '-d', '--build'], {
        stdio: 'inherit',
        shell: true
    });

    child.on('exit', async (code) => {
        if (code !== 0) {
            console.error(`\n❌ Restart failed with exit code ${code}`);
            process.exit(code);
        }

        console.log('\n⌛ Waiting for the server to stabilize...');
        console.log('   (This may take a few minutes for initial boot or heavy environments)');

        let startTime = Date.now();
        let ready = false;
        let dots = '';
        let errorReason = null;

        while (Date.now() - startTime < MAX_WAIT_SEC * 1000) {
            ready = await isServerReady();
            if (ready) break;

            // Check logs for obvious failures
            const logCheck = await new Promise((resolve) => {
                const lp = spawn('docker', ['logs', '--tail', '50', 'openclaw-gemini-adapter'], { shell: true });
                let output = '';
                lp.stdout.on('data', d => output += d);
                lp.stderr.on('data', d => output += d);
                lp.on('close', () => {
                    if (output.includes('Config invalid') || output.includes('Unrecognized key')) {
                        const lines = output.split('\n');
                        const errorLine = lines.find(l => l.includes('Config invalid') || l.includes('Unrecognized key')) || 'Config validation failed';
                        resolve({ fail: true, reason: errorLine.trim() });
                    } else if (output.includes('Error: ') || output.includes('FATAL')) {
                        resolve({ fail: true, reason: 'Server crashed or fatal error detected' });
                    } else {
                        resolve({ fail: false });
                    }
                });
            });

            if (logCheck.fail) {
                errorReason = logCheck.reason;
                break;
            }

            dots = dots.length > 5 ? '' : dots + '.';
            process.stdout.write(`\r   Booting${dots.padEnd(6)} [${Math.floor((Date.now() - startTime) / 1000)}s]`);
            await wait(2000);
        }

        if (ready) {
            console.log('\n\n✅ Server is UP and STABLE!');
            console.log(`🔗 Dashboard: ${CHECK_URL}`);
            console.log('To view logs: docker logs -f openclaw-gemini-adapter');
        } else {
             console.error(`\n\n❌ Boot failed ${errorReason ? ': ' + errorReason : '(Timeout)'}`);
             console.log('--- Last 20 lines of container log ---');
             const finalLog = spawn('docker', ['logs', '--tail', '20', 'openclaw-gemini-adapter'], { stdio: 'inherit', shell: true });
             finalLog.on('close', () => {
                 console.log('---------------------------------------');
                 console.error('Please fix the configuration and try again.');
                 process.exit(1);
             });
             return;
        }
        process.exit(0);
    });
}

main().catch(err => {
    console.error('\n❌ Unhandled error:', err);
    process.exit(1);
});
