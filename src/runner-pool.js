const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const __dir = path.resolve(__dirname, '..');

/**
 * openclaw.json から agents.defaults.workspace の値を読み取り、
 * 絶対パスに解決して返す。取得できない場合は ~/.openclaw/workspace をフォールバック。
 */
function resolveOpenClawWorkspace() {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const configPath = path.join(openclawDir, 'openclaw.json');
    let workspace = './workspace'; // デフォルト
    try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (cfg?.agents?.defaults?.workspace) {
            workspace = cfg.agents.defaults.workspace;
        }
    } catch (e) {
        console.warn(`[Pool] Could not read openclaw.json, using default workspace: ${e.message}`);
    }
    // 相対パスなら ~/.openclaw を基準に解決
    const resolved = path.isAbsolute(workspace)
        ? workspace
        : path.resolve(openclawDir, workspace);
    console.log(`[Pool] Resolved OpenClaw workspace: ${resolved}`);
    return resolved;
}

/**
 * Gemini CLI が OpenClaw MCP ツールを認識できるよう、
 * プラグイン専用の独立した GEMINI_CLI_HOME ディレクトリを準備する。
 *
 * - プロジェクトルートの gemini-home/.gemini/settings.json を直接利用・更新する
 * - ユーザーのグローバルな ~/.gemini は一切汚染しない
 * - 資格情報が存在しない場合は、グローバルからのコピーではなくエラーログを出す（setup.js での認証を促す）
 */
function prepareIsolatedGeminiHome(workspaceCwd) {
    const baseDir = path.resolve(__dirname, '..');
    const isolatedHomeDir = path.join(baseDir, 'gemini-home');
    const isolatedGeminiDir = path.join(isolatedHomeDir, '.gemini');
    
    if (!fs.existsSync(isolatedGeminiDir)) {
        fs.mkdirSync(isolatedGeminiDir, { recursive: true });
    }

    for (const file of ['oauth_creds.json', 'google_accounts.json', 'installation_id']) {
        const src = path.join(baseDir, 'gemini-home', '.gemini', file);
        if (!fs.existsSync(src)) continue;
        try { fs.copyFileSync(src, path.join(isolatedGeminiDir, file)); } catch (_) {}
    }

    // 1. 隔離環境の settings.json を読み込み、openclaw-tools MCP を注入
    const settingsPath = path.join(isolatedGeminiDir, 'settings.json');
    let userSettings = { mcpServers: {} };
    try {
        if (fs.existsSync(settingsPath)) {
            userSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
    } catch (_) {}

    userSettings.mcpServers = userSettings.mcpServers || {};
    userSettings.mcpServers['openclaw-tools'] = {
        command: 'node',
        args: [path.join(baseDir, 'mcp-server.mjs'), 'pool-shared', workspaceCwd],
        trust: true
    };

    fs.writeFileSync(
        settingsPath,
        JSON.stringify(userSettings, null, 2),
        'utf-8'
    );

    // 2. 資格情報の存在チェック（警告用）
    const hasCreds = fs.existsSync(path.join(isolatedGeminiDir, 'oauth_creds.json')) || 
                    fs.existsSync(path.join(isolatedGeminiDir, 'google_accounts.json'));
    
    if (!hasCreds) {
        console.warn(`[Pool] WARNING: No Gemini credentials found in ${isolatedGeminiDir}. Did you run setup.js / gemini login?`);
    }

    console.log(`[Pool] Prepared isolated GEMINI_CLI_HOME: ${isolatedHomeDir}`);
    console.log(`[Pool] MCP servers: ${Object.keys(userSettings.mcpServers).join(', ')}`);
    return isolatedHomeDir;
}

class RunnerPool {
    constructor() {
        this.readyRunner = null;
        this.pendingRequests = []; // Array of { request, resolve, reject }
        this.isSpawning = false;
        
        // サーバー起動時に1度だけ openclaw.json から workspace を解決
        this.workspaceCwd = resolveOpenClawWorkspace();
        
        // OpenClaw MCPツール入りの独立した GEMINI_CLI_HOME を準備
        this.isolatedGeminiHome = prepareIsolatedGeminiHome(this.workspaceCwd);
        
        // サーバー起動と同時に事前起動（Warm up）開始
        this.spawnNewRunner();
    }

    spawnNewRunner() {
        if (this.isSpawning) return;
        this.isSpawning = true;
        
        console.log("[Pool] Spawning a new warm standby runner...");
        const runnerPath = path.resolve(__dirname, 'runner.js');
        
        let execCmd = 'bun';
        const bunPath = path.join(os.homedir(), '.bun', 'bin', 'bun');
        if (fs.existsSync(bunPath)) {
            execCmd = bunPath; // PATHが通っていない場合のための絶対パス指定
        }

        const runner = spawn(execCmd, [runnerPath, '--yolo', '-o', 'stream-json'], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            cwd: this.workspaceCwd,
            env: {
                ...process.env,
                GEMINI_CLI_HOME: this.isolatedGeminiHome,
            }
        });
        
        runner.once('message', (msg) => {
            if (msg.type === 'ready') {
                this.isSpawning = false;
                console.log("[Pool] Runner is ready to accept requests.");
                
                // キューに待たせているリクエストがあれば即時ひも付け
                if (this.pendingRequests.length > 0) {
                    const req = this.pendingRequests.shift();
                    this.assignRunner(runner, req);
                } else {
                    // なければ待機状態として保持
                    this.readyRunner = runner;
                }
            }
        });
        
        runner.once('exit', (code) => {
            // プロセスが終了（使い捨て完了）したら次のプロセスを補充する
            console.log(`[Pool] Runner consumed (exited with code ${code}). Spawning next...`);
            this.readyRunner = null;
            this.isSpawning = false; // エラー落ちなどでフラグが残るのを防ぐ
            this.spawnNewRunner();
        });

        runner.on('error', (err) => {
            console.error("[Pool] Runner process error:", err);
            this.isSpawning = false;
            
            // Bun起動失敗時のフォールバック (Node.js)
            if (err.code === 'ENOENT' && execCmd.includes('bun')) {
                console.log("[Pool] Bun runtime not found. Falling back to Node.js.");
                this.spawnNewRunnerWithNode();
            }
        });
    }

    spawnNewRunnerWithNode() {
        if (this.isSpawning) return;
        this.isSpawning = true;
        
        console.log("[Pool] Spawning runner (Node.js fallback)...");
        const runnerPath = path.resolve(__dirname, 'runner.js');
        const runner = spawn('node', [runnerPath, '--yolo', '-o', 'stream-json'], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            cwd: this.workspaceCwd,
            env: {
                ...process.env,
                GEMINI_CLI_HOME: this.isolatedGeminiHome,
            }
        });
        
        runner.once('message', (msg) => {
            if (msg.type === 'ready') {
                this.isSpawning = false;
                console.log("[Pool] Runner is ready to accept requests (Node fallback).");
                if (this.pendingRequests.length > 0) {
                    const req = this.pendingRequests.shift();
                    this.assignRunner(runner, req);
                } else {
                    this.readyRunner = runner;
                }
            }
        });
        
        runner.once('exit', (code) => {
            console.log(`[Pool] Runner (Node fallback) consumed (exited with code ${code}).`);
            this.readyRunner = null;
            this.isSpawning = false;
            this.spawnNewRunnerWithNode();
        });

        runner.on('error', (err) => {
            console.error("[Pool] Runner process error (Node fallback):", err);
            this.isSpawning = false;
        });
    }

    /**
     * 実行可能なRunnerプロセスを取得（または待機）します。
     * @param {Object} request { input, promptId, resumedSessionData, model, env, mediaPaths }
     * @returns {Promise<ChildProcess>} プロンプト送信済みのRunnerプロセス
     */
    async acquireRunner(request) {
        return new Promise((resolve, reject) => {
            if (this.readyRunner) {
                // すでに待機プロセスがいれば、それを取り出してキューを通さず即時実行
                const runner = this.readyRunner;
                this.readyRunner = null;
                this.assignRunner(runner, { request, resolve, reject });
            } else {
                // 初期化中 or 他の処理中ならキューに追加
                console.log("[Pool] No runners ready. Queuing request...");
                this.pendingRequests.push({ request, resolve, reject });
            }
        });
    }

    assignRunner(runner, pendingReq) {
        const { request, resolve } = pendingReq;
        // Runnerにプロンプト実行の号令をかける
        console.log(`[Pool] Dispatching runner for session: ${request.resumedSessionData?.conversation?.sessionId || 'none'} (model: ${request.model || 'default'})`);
        runner.send({ 
            type: 'run', 
            input: request.input, 
            prompt_id: request.promptId, 
            resumedSessionData: request.resumedSessionData,
            model: request.model,
            env: request.env,
            mediaPaths: request.mediaPaths
        });
        
        // 呼び出し元（Streaming層）へ、入出力ストリームを持つRunnerプロセスを返す
        resolve(runner);
    }

    /**
     * キューで待機中のリクエストをキャンセルする。
     * HTTP 接続が切断された場合に、まだ Runner が割り当てられていない
     * リクエストをキューから除去するために使用する。
     * @param {string} promptId キャンセル対象のプロンプトID
     * @returns {boolean} キャンセルに成功したか
     */
    cancelPending(promptId) {
        const idx = this.pendingRequests.findIndex(
            p => p.request.promptId === promptId
        );
        if (idx !== -1) {
            const removed = this.pendingRequests.splice(idx, 1)[0];
            removed.reject(new Error('Request cancelled: client disconnected'));
            console.log(`[Pool] Cancelled pending request: ${promptId}`);
            return true;
        }
        return false;
    }
}

// シングルトンとしてエクスポート
module.exports = { runnerPool: new RunnerPool() };
