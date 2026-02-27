const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const PORT = 19872;
const PLUGIN_DIR = __dirname;
const PUBLIC_DIR = path.join(PLUGIN_DIR, 'public');
const GEMINI_CREDS_DIR = path.join(PLUGIN_DIR, "src", ".gemini");

// Paths relative to home dir (for OpenClaw main)
const HOME_DIR = os.homedir();
const OPENCLAW_ROOT = path.resolve(PLUGIN_DIR, '..'); // Assuming adapter is inside OpenClaw
const OPENCLAW_CONFIG = path.join(HOME_DIR, ".openclaw", "openclaw.json");

// Define paths for credentials
const credsPaths = [
    path.join(GEMINI_CREDS_DIR, ".gemini", "oauth_creds.json"),
    path.join(GEMINI_CREDS_DIR, ".gemini", "google_accounts.json"),
    path.join(GEMINI_CREDS_DIR, "oauth_creds.json"),
    path.join(GEMINI_CREDS_DIR, "google_accounts.json"),
];

// Helper: Check for valid Gemini CLI credentials
function hasValidCredentials() {
    for (const p of credsPaths) {
        if (!fs.existsSync(p)) continue;
        try {
            const raw = fs.readFileSync(p, 'utf-8').trim();
            if (!raw || raw.length < 10) continue;
            const data = JSON.parse(raw);
            if (data.refresh_token || data.access_token) return true;
            if (data.active !== undefined && data.active !== null) return true;
        } catch (e) { }
    }
    return false;
}

// Global state for SSE clients (logging)
let logClients = [];

function broadcastLog(message, type = 'log') {
    const data = `data: ${JSON.stringify({ type, message })}\n\n`;
    logClients.forEach(client => client.write(data));
    if (type !== 'progress' && type !== 'done') {
        console.log(`[GUI-LOG] ${message}`);
    }
}

// Ensure public directory exists
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// The HTTP Server
const server = http.createServer((req, res) => {
    // CORS (allow local if testing separate client, though we serve them together)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ----- STATIC FILE ROUTING -----
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'installer.html' : url.pathname);
        
        // Prevent path traversal
        if (!filePath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403);
            return res.end('Forbidden');
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end('Not Found');
        }

        const ext = path.extname(filePath);
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.svg': 'image/svg+xml'
        };

        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    // ----- API ROUTING -----

    // 1. Logs SSE stream
    if (req.method === 'GET' && url.pathname === '/api/logs') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        logClients.push(res);
        req.on('close', () => {
            logClients = logClients.filter(c => c !== res);
        });
        return;
    }

    // Helper to parse JSON body
    const parseBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); } 
            catch (e) { resolve({}); }
        });
    });

    const sendJson = (statusCode, data) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    // 2. Status check
    if (req.method === 'GET' && url.pathname === '/api/status') {
        const isOpenClawRoot = fs.existsSync(path.join(OPENCLAW_ROOT, "package.json"));
        const hasAuth = hasValidCredentials();
        return sendJson(200, { isOpenClawRoot, hasAuth });
    }

    // 3. Exit server
    if (req.method === 'POST' && url.pathname === '/api/exit') {
        sendJson(200, { success: true });
        console.log("GUI setup finished. Exiting server...");
        setTimeout(() => process.exit(0), 1000);
        return;
    }

    // 4. Setup Execution
    if (req.method === 'POST' && url.pathname === '/api/setup') {
        parseBody().then(async (body) => {
            sendJson(200, { started: true });
            
            const setPrimary = body.setPrimary || false;
            let success = true;

            const runCmd = (cmd, cwd, stepName) => {
                return new Promise((resolve) => {
                    broadcastLog(`Starting: ${stepName}`, 'step_start');
                    const child = spawn(cmd, { shell: true, cwd });
                    child.stdout.on('data', d => broadcastLog(d.toString(), 'stdout'));
                    child.stderr.on('data', d => broadcastLog(d.toString(), 'stderr'));
                    child.on('close', code => {
                        if (code === 0) {
                            broadcastLog(`✓ Success: ${stepName}`, 'step_done');
                            resolve(true);
                        } else {
                            broadcastLog(`✗ Failed: ${stepName} (Exit code ${code})`, 'step_error');
                            resolve(false);
                        }
                    });
                });
            };

            // Step A: Package installation
            if (!fs.existsSync(path.join(PLUGIN_DIR, 'node_modules'))) {
                const depOk = await runCmd('npm install', PLUGIN_DIR, "Installing dependencies");
                if (!depOk) success = false;
            } else {
                broadcastLog("Dependencies already installed, skipping npm install.", 'log');
            }

            // Step B: Models sync
            if (success) {
                const syncOk = await runCmd('node scripts/update_models.mjs', PLUGIN_DIR, "Syncing Gemini Models");
                if (!syncOk) broadcastLog("Warning: Model sync failed, but continuing...", 'warning');
            }

            // Step C: OpenClaw config writing
            if (success) {
                broadcastLog("Registering adapter in openclaw.json...", 'step_start');
                try {
                    let config = {};
                    if (fs.existsSync(OPENCLAW_CONFIG)) {
                        try { config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, "utf-8")); } 
                        catch (e) { /* ignore parse error, make new */ }
                    } else {
                        fs.mkdirSync(path.dirname(OPENCLAW_CONFIG), { recursive: true });
                    }

                    if (!config.models) config.models = {};
                    if (setPrimary) {
                        config.models.primary = "gemini-adapter/auto-gemini-3";
                        broadcastLog("Set gemini-adapter as primary model.", 'log');
                    }

                    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), "utf-8");
                    broadcastLog("✓ Registered adapter in openclaw.json", 'step_done');
                } catch (e) {
                    broadcastLog(`Error writing config: ${e.message}`, 'step_error');
                    success = false;
                }
            }
            
            broadcastLog(success ? "Setup steps completed successfully." : "Setup encountered errors.", 'done');
        });
        return;
    }

    // 5. Auth Start
    if (req.method === 'POST' && url.pathname === '/api/auth/start') {
        const localGeminiPath = path.join(PLUGIN_DIR, "node_modules", ".bin", "gemini");
        const commandToRun = fs.existsSync(localGeminiPath) ? localGeminiPath : "npx gemini";
        
        const child = spawn(commandToRun.split(' ')[0], commandToRun.split(' ').slice(1).concat(['login']), {
            cwd: PLUGIN_DIR,
            env: { ...process.env, GEMINI_CLI_HOME: GEMINI_CREDS_DIR },
            stdio: 'pipe' // Capture stdout to ignore interactive prompts via the web
        });

        // We don't really care about the CLI output itself since it opens the browser,
        // but it's important not to block.

        // Poll for completion to kill it automatically just like CLI setup
        let killed = false;
        const checkInterval = setInterval(() => {
            if (hasValidCredentials() && !killed) {
                killed = true;
                clearInterval(checkInterval);
                setTimeout(() => {
                    try { child.kill('SIGKILL'); } catch(e){}
                }, 1500);
            }
        }, 2000);

        child.on('close', () => { clearInterval(checkInterval); });

        return sendJson(200, { message: "Authentication process started" });
    }

    // 6. Auth Status
    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        return sendJson(200, { hasAuth: hasValidCredentials() });
    }

    res.writeHead(404);
    res.end('Not Found');
});

// Auto-open browser when server starts (if not explicitly disabled)
const osType = os.type();
let openCmd = '';
if (osType === 'Darwin') openCmd = 'open';
else if (osType === 'Windows_NT') openCmd = 'start';
else openCmd = 'xdg-open';

server.listen(PORT, '127.0.0.1', () => {
    console.log(`GUI Installer Server running at http://127.0.0.1:${PORT}`);
    console.log(`Please wait while the browser opens...`);
    
    // Automatically open the browser
    if (openCmd && !process.env.NO_AUTO_OPEN) {
        try {
            require('child_process').exec(`${openCmd} http://127.0.0.1:${PORT}`);
        } catch (e) {
            console.log(`Failed to open browser automatically. Please visit http://127.0.0.1:${PORT}`);
        }
    }
});
