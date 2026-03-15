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
    const resolved = (path.isAbsolute(workspace)
        ? workspace
        : path.resolve(openclawDir, workspace)).trim();

    // spawn の cwd に指定するため、存在しない場合は作成する
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
        console.log(`[Pool] Created workspace directory: ${resolved}`);
    }

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

    const realGeminiHome = process.env.GEMINI_CLI_HOME;
    if (!realGeminiHome) {
        throw new Error("CRITICAL: GEMINI_CLI_HOME environment variable is not defined. Please check your .env or docker-compose.yml.");
    }
    // コンテナ内の二重構造（/root/.gemini/.gemini）を避け、
    // GEMINI_CLI_HOME 直下（通常は /root/.gemini/）から直接ファイルをコピーする。
    // ※ docker-compose.yml のマウント設定により、/root/.gemini/ が実体。
    const srcBase = path.join(realGeminiHome, '.gemini');
    const finalSrcBase = fs.existsSync(srcBase) ? srcBase : realGeminiHome;

    for (const file of ['oauth_creds.json', 'google_accounts.json', 'installation_id']) {
        const src = path.join(finalSrcBase, file);
        if (!fs.existsSync(src)) continue;
        try { fs.copyFileSync(src, path.join(isolatedGeminiDir, file)); } catch (_) { }
    }

    // gogcli の認証情報のコピー (SSoT 4.0 安定化)
    // 隔離環境でも gogcli がトークンを認識できるよう、.config/gogcli を同期する。
    const srcGogConfig = path.join(os.homedir(), '.config', 'gogcli');
    const destGogConfig = path.join(isolatedHomeDir, '.config', 'gogcli');
    console.log(`[Pool] Syncing gogcli config: ${srcGogConfig} -> ${destGogConfig}`);
    if (fs.existsSync(srcGogConfig)) {
        try {
            fs.mkdirSync(destGogConfig, { recursive: true });
            fs.cpSync(srcGogConfig, destGogConfig, { recursive: true, force: true });
            console.log(`[Pool] Copied gogcli config. Files in dest: ${fs.readdirSync(destGogConfig).join(', ')}`);
            const keyringDir = path.join(destGogConfig, 'keyring');
            if (fs.existsSync(keyringDir)) {
                console.log(`[Pool] Tokens in dest keyring: ${fs.readdirSync(keyringDir).join(', ')}`);
            }
        } catch (e) {
            console.warn(`[Pool] Failed to copy gogcli config: ${e.message}`);
        }
    } else {
        console.warn(`[Pool] Source gogcli config not found: ${srcGogConfig}`);
    }

    // スキルディレクトリのコピー (再帰的)
    const srcSkills = path.join(finalSrcBase, 'skills');
    const destSkills = path.join(isolatedGeminiDir, 'skills');
    if (fs.existsSync(srcSkills)) {
        try {
            // Node 16.7.0+ の cpSync を使用。存在しない場合は作成、既存の場合は上書き
            fs.cpSync(srcSkills, destSkills, { recursive: true, force: true });
        } catch (e) {
            console.warn(`[Pool] Failed to copy skills directory: ${e.message}`);
        }
    }

    // 1. 本環境の settings.json をベースに読み込み、openclaw-tools MCP を注入
    const realSettingsPath = path.join(finalSrcBase, 'settings.json');
    const isolatedSettingsPath = path.join(isolatedGeminiDir, 'settings.json');
    let userSettings = { mcpServers: {} };
    try {
        if (fs.existsSync(realSettingsPath)) {
            userSettings = JSON.parse(fs.readFileSync(realSettingsPath, 'utf-8'));
        } else if (fs.existsSync(isolatedSettingsPath)) {
            userSettings = JSON.parse(fs.readFileSync(isolatedSettingsPath, 'utf-8'));
        }
    } catch (_) { }

    userSettings.mcpServers = userSettings.mcpServers || {};
    // デバッグ用: stderr を logs/mcp.log にリダイレクトするシェルラッパーを一時的に復活
    const mcpLogPath = path.join(baseDir, 'logs', 'mcp.log');
    userSettings.mcpServers['openclaw-tools'] = {
        command: 'bash',
        args: ['-c', `node "${path.join(baseDir, 'mcp-server.mjs')}" "pool-shared" "${workspaceCwd}" 2>> "${mcpLogPath}"`],
        trust: true
    };

    // 2. スキル有効化の注入 (SSoT 4.0)
    // ソースコード調査の結果、settings.json に skills.path は存在せず、
    // GEMINI_CLI_HOME/skills(/root/.gemini/skills) が自動検出されるためフラグのみ設定。
    userSettings.skills = userSettings.skills || {};
    userSettings.skills.enabled = true;

    // 信頼フォルダの登録: config.js L426-428 では trustedFolder=false の場合に
    // --approval-mode=yolo が強制的に DEFAULT に落とされ run_shell_command が無効化される。
    // ワークスペースと隔離ホームを両方信頼リストに追加して YOLO モードを維持する。
    userSettings.security = userSettings.security || {};
    userSettings.security.folderTrust = userSettings.security.folderTrust || {};
    const existingTrusted = userSettings.security.folderTrust.trustedFolders || [];
    userSettings.security.folderTrust.trustedFolders = Array.from(new Set([
        ...existingTrusted,
        workspaceCwd,
        isolatedHomeDir,
    ]));

    fs.writeFileSync(
        isolatedSettingsPath,
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

        console.log("[Pool] Spawning a new warm standby runner (Node.js)...");
        const runnerPath = path.resolve(__dirname, 'runner.mjs');

        // Node.js バイナリの堅牢な解決ロジック
        // 優先順位:
        //   1. adapter-node-path.txt に保存されたセットアップ時のパス（最も確実）
        //   2. process.execPath が node の場合はそれを使用
        //   3. which node でパスを検索
        //   4. 定番の絶対パスへのフォールバック
        //   5. 最終手段：環境の PATH に任せる
        const resolveNodeBin = () => {
            // 1. adapter-node-path.txt に保存されたパス（第一選択）
            try {
                const nodePathFile = path.join(os.homedir(), '.openclaw', 'adapter-node-path.txt');
                if (fs.existsSync(nodePathFile)) {
                    const savedPath = fs.readFileSync(nodePathFile, 'utf-8').trim();
                    if (savedPath && fs.existsSync(savedPath)) {
                        return savedPath;
                    }
                }
            } catch (_) { }

            // 2. process.execPath が node の場合はそれを使用
            const execPath = process.execPath;
            if (path.basename(execPath).startsWith('node')) {
                return execPath;
            }
            // 3. process.execPath が node でない（openclaw バイナリ等）場合、PATH から探す
            try {
                const { execFileSync } = require('child_process');
                const resolved = execFileSync('which', ['node'], { encoding: 'utf-8' }).trim();
                if (resolved) return resolved;
            } catch (_) {
                // which が失敗した場合は既知の絶対パスへフォールバック
            }
            // 4. 定番の絶対パスを順に試す
            for (const p of ['/usr/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node']) {
                if (fs.existsSync(p)) return p;
            }
            // 5. 最終手段：環境への PATH 解決に任せる（失敗する可能性はある）
            return 'node';
        };

        const execCmd = resolveNodeBin();
        console.log(`[Pool] Resolved node binary: ${execCmd}`);

        const runner = spawn(execCmd, [runnerPath, '--approval-mode=yolo', '--sandbox=false', '-o', 'stream-json'], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            cwd: this.workspaceCwd,
            env: {
                ...process.env,
                GEMINI_CLI_HOME: this.isolatedGeminiHome,
                // gogcli が隔離ディレクトリの認証情報を読めるようにする。
                // これがないと gog コマンドが ~/.config/gogcli を読みに行き missing --account で失敗する。
                XDG_CONFIG_HOME: path.join(this.isolatedGeminiHome, '.config'),
                // WSL/Linux 環境で GNOME キーリング等が利用できない場合のハング防止。
                // ファイルベースのキーリングを明示して対話プロンプトを完全にバイパスする。
                GOG_KEYRING_BACKEND: 'file',
                GOG_KEYRING_PASSWORD: 'openclaw-adapter',
            }
        });

        let isReady = false;
        const markReady = () => {
            if (isReady) return;
            isReady = true;
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
        };

        // IPCメッセージによるReady検知
        runner.once('message', (msg) => {
            if (msg.type === 'ready') {
                markReady();
            }
        });

        // 標準出力・標準エラーの監視（ハング防止＆フォールバック検知）
        let startupStderr = '';
        runner.stderr.on('data', (chunk) => {
            const raw = chunk.toString();
            // 起動時のエラーをキャッチしてログに出す
            if (!isReady) {
                startupStderr += raw;
                // 万が一致命的なエラーならログを出す
                if (startupStderr.includes('Error') || startupStderr.includes('Exception')) {
                    console.error(`[Pool] Runner startup stderr: ${raw.trim()}`);
                }
            }
        });

        runner.stdout.on('data', (chunk) => {
            const raw = chunk.toString();
            // 手動実行などの非IPC環境でもReadyを検知するフォールバック
            if (!isReady && raw.includes('[Runner] Ready')) {
                markReady();
            }
        });

        runner.once('exit', (code, signal) => {
            // プロセスが終了（使い捨て完了）したら次のプロセスを補充する
            console.log(`[Pool] Runner consumed (exited with code ${code}, signal ${signal}). Spawning next...`);
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
