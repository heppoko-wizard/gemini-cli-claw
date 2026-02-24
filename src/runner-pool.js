const { spawn } = require('child_process');
const path = require('path');

class RunnerPool {
    constructor() {
        this.readyRunner = null;
        this.pendingRequests = []; // Array of { request, resolve, reject }
        this.isSpawning = false;
        
        // サーバー起動と同時に事前起動（Warm up）開始
        this.spawnNewRunner();
    }

    spawnNewRunner() {
        if (this.isSpawning) return;
        this.isSpawning = true;
        
        console.log("[Pool] Spawning a new warm standby runner...");
        const runnerPath = path.resolve(__dirname, 'runner.js');
        const runner = spawn('bun', [runnerPath, '--yolo', '-o', 'stream-json'], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
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
     * @param {Object} request { input, promptId, resumeSessionId }
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
            model: request.model 
        });
        
        // 呼び出し元（Streaming層）へ、入出力ストリームを持つRunnerプロセスを返す
        resolve(runner);
    }
}

// シングルトンとしてエクスポート
module.exports = { runnerPool: new RunnerPool() };
