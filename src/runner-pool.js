const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

class RunnerPool {
    constructor() {
        this.readyRunner = null;
        this.pendingRequests = []; // Array of { request, resolve, reject }
        this.isSpawning = false;
        
        // サーバー起動時に1度だけ openclaw.json から workspace を解決
        this.workspaceCwd = resolveOpenClawWorkspace();
        
        // サーバー起動と同時に事前起動（Warm up）開始
        this.spawnNewRunner();
    }

    spawnNewRunner() {
        if (this.isSpawning) return;
        this.isSpawning = true;
        
        console.log("[Pool] Spawning a new warm standby runner...");
        const runnerPath = path.resolve(__dirname, 'runner.js');
        const runner = spawn('bun', [runnerPath, '--yolo', '-o', 'stream-json'], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            cwd: this.workspaceCwd
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
}

// シングルトンとしてエクスポート
module.exports = { runnerPool: new RunnerPool() };
