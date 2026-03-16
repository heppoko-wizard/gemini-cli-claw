'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, randomId, sseWrite } = require('./utils');

// ---------------------------------------------------------------------------
// SSoT 6.0: ツールコンテキストストア
// tool_call_request/tool_result の実データをアダプター側で保持する。
// OpenClaw には軽量マーカー（⚙️ tooluse[name][callId]）のみを送出する。
// 次ターンの履歴受信時に callId を使ってリハイドレートし、
// Gemini CLI 向けの正規 toolCalls 構造に復元する。
// ---------------------------------------------------------------------------

// セッションキー → callId → { name, args, result } のネストした Map
const toolMemoryStore = new Map();
const CONTEXT_BASE_DIR = '/app/logs/contexts';

function getSessionStore(sessionKey) {
    if (!toolMemoryStore.has(sessionKey)) {
        toolMemoryStore.set(sessionKey, new Map());
        // セッションごとのディレクトリ作成
        const sessionDir = path.join(CONTEXT_BASE_DIR, sessionKey);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
    }
    return toolMemoryStore.get(sessionKey);
}

/**
 * ツール情報をメモリとファイルの両方に保存する
 */
function storeToolContext(sessionKey, callId, data) {
    const sessionStore = getSessionStore(sessionKey);
    const existing = sessionStore.get(callId) || {};
    const updated = { ...existing, ...data };
    
    // メモリに保存
    sessionStore.set(callId, updated);
    
    // ファイルに保存
    try {
        const filePath = path.join(CONTEXT_BASE_DIR, sessionKey, `${callId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
        log(`[tool-store] Persisted context: ${sessionKey}/${callId}.json`);
    } catch (e) {
        log(`[tool-store] ERROR persisting context: ${e.message}`);
    }
}

/**
 * ツール情報をメモリから取得し、なければファイルからロードする
 */
function loadToolContext(sessionKey, callId) {
    const sessionStore = getSessionStore(sessionKey);
    if (sessionStore.has(callId)) {
        return sessionStore.get(callId);
    }
    
    // ファイルからロードを試みる
    try {
        const filePath = path.join(CONTEXT_BASE_DIR, sessionKey, `${callId}.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            sessionStore.set(callId, data);
            log(`[tool-store] Loaded context from file: ${sessionKey}/${callId}.json`);
            return data;
        }
    } catch (e) {
        log(`[tool-store] ERROR loading context from file: ${e.message}`);
    }
    return null;
}


// ---------------------------------------------------------------------------
// Gemini CLI discovery
// ---------------------------------------------------------------------------

const __dir = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Per-session Gemini CLI environment setup
// ---------------------------------------------------------------------------

/**
 * Prepare an isolated GEMINI_CLI_HOME directory for this OpenClaw session,
 * injecting our MCP server and copying auth credentials.
 *
 * Returns { env, chatsDir, tempSystemMdPath }.
 */
function prepareGeminiEnv({ sessionKey, workspaceDir, systemPrompt }) {
    const homeBaseDir = path.join(__dir, 'gemini-home', 'gemini-sessions');
    const tempHomeDir = path.join(homeBaseDir, sessionKey);
    const tempGeminiDir = path.join(tempHomeDir, '.gemini');
    const chatsDir = path.join(tempGeminiDir, 'tmp', 'openclaw-gemini-cli-adapter', 'chats');

    fs.mkdirSync(chatsDir, { recursive: true });

    // --- settings.json with MCP server injection ---
    const realGeminiHome = process.env.GEMINI_CLI_HOME;
    if (!realGeminiHome) {
        throw new Error("CRITICAL: GEMINI_CLI_HOME environment variable is not defined.");
    }
    const realGeminiDir = path.join(realGeminiHome, '.gemini');
    const realSettingsPath = path.join(realGeminiDir, 'settings.json');
    let userSettings = {};
    try {
        if (fs.existsSync(realSettingsPath)) {
            userSettings = JSON.parse(fs.readFileSync(realSettingsPath, 'utf-8'));
        }
    } catch (_) { }

    userSettings.mcpServers = userSettings.mcpServers || {};
    userSettings.mcpServers['openclaw-tools'] = {
        command: 'node',
        args: [path.join(__dir, 'mcp-server.mjs'), sessionKey, workspaceDir || process.cwd()],
        trust: true,
    };

    fs.writeFileSync(
        path.join(tempGeminiDir, 'settings.json'),
        JSON.stringify(userSettings, null, 2),
        'utf-8'
    );

    // --- Copy auth credentials ---
    for (const file of ['oauth_creds.json', 'google_accounts.json', 'installation_id']) {
        const src = path.join(realGeminiDir, file);
        if (!fs.existsSync(src)) continue;
        try { fs.copyFileSync(src, path.join(tempGeminiDir, file)); } catch (_) { }
    }

    // --- Write system prompt to a temp .md file ---
    const tempSystemMdPath = path.join(
        os.tmpdir(),
        `gemini-system-${randomId()}.md`
    );
    fs.writeFileSync(tempSystemMdPath, systemPrompt || '# OpenClaw Gemini Gateway', 'utf-8');

    const env = {
        ...process.env,
        GEMINI_SYSTEM_MD: tempSystemMdPath,
        GEMINI_CLI_HOME: tempHomeDir,
    };

    return { env, chatsDir, tempSystemMdPath };
}

// ---------------------------------------------------------------------------
// Gemini CLI runner (streaming → SSE)
// ---------------------------------------------------------------------------

const { runnerPool } = require('./runner-pool.js');

/**
 * Spawn Gemini CLI with the provided prompt and optional --resume session,
 * streaming output back as OpenAI-compatible SSE chunks via RunnerPool.
 */
async function runGeminiStreaming({ prompt, messages, model, sessionName, mediaPaths, env, res, requestId, onSessionId, sessionKey }) {
    const responseId = `resp_${requestId}`;
    const perfStart = Date.now();
    let perfFirstToken = null;

    // Send initial completions chunk
    sseWrite(res, {
        id: responseId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gemini',
        choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null
        }]
    });

    // killRunner は try ブロック内で runner 取得後に代入される
    let killRunner = null;

    try {
        log(`[adapter] Acquiring runner for sessionKey: ${sessionKey}`);

        // 履歴をGemini CLIの内部SessionData形式に合成する (SSoT 3.0)
        let resumedSessionData = undefined;
        if (messages && messages.length > 0) {
            const geminiMessages = [];
            const timestamp = new Date().toISOString();

            // SSoT 6.0: ツールマーカー検出正規表現
            const TOOL_MARKER_RE = /\n?⚙️ tooluse\[([^\]]+)\]\[([^\]]+)\]\n?/g;
            const sessionStore = getSessionStore(sessionKey);

            for (const msg of messages) {
                let text = '';
                if (typeof msg.content === 'string') {
                    text = msg.content;
                } else if (Array.isArray(msg.content)) {
                    text = msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                }

                if (msg.role === 'user') {
                    geminiMessages.push({
                        type: 'user',
                        content: [{ text: text }]
                    });
                } else if (msg.role === 'assistant') {
                    // SSoT 6.0: テキスト内の ⚙️ tooluse マーカーを検出してリハイドレート
                    const toolCallsFromMarkers = [];
                    let cleanText = text;
                    let match;
                    TOOL_MARKER_RE.lastIndex = 0;
                    while ((match = TOOL_MARKER_RE.exec(text)) !== null) {
                        const [fullMatch, markerName, markerCallId] = match;
                        const stored = loadToolContext(sessionKey, markerCallId);
                        if (stored) {
                            log(`[history] Rehydrating tool: ${markerName} [${markerCallId}]`);
                            toolCallsFromMarkers.push({
                                id: markerCallId,
                                name: stored.name,
                                args: stored.args,
                                status: 'success',
                                timestamp: new Date().toISOString(),
                                result: stored.result ? [{
                                    functionResponse: {
                                        name: stored.name,
                                        response: { output:
                                            typeof stored.result === 'string'
                                                ? stored.result
                                                : JSON.stringify(stored.result)
                                        }
                                    }
                                }] : undefined,
                            });
                            cleanText = cleanText.replace(fullMatch, '');
                        } else {
                            log(`[history] WARN: No stored data for tool marker: ${markerName} [${markerCallId}]`);
                        }
                    }

                    geminiMessages.push({
                        type: 'gemini',
                        content: [{ text: cleanText.trim() }],
                        ...(toolCallsFromMarkers.length > 0 ? { toolCalls: toolCallsFromMarkers } : {})
                    });
                } else if (msg.role === 'tool') {
                    const resultToolCallId = msg.tool_call_id || '';
                    const result = typeof msg.content === 'string' ? msg.content : '';
                    const lastGemini = [...geminiMessages].reverse().find(m => m.type === 'gemini');
                    if (lastGemini && lastGemini.toolCalls) {
                        const matchingCall = lastGemini.toolCalls.find(tc => tc.id === resultToolCallId);
                        if (matchingCall) {
                            matchingCall.result = [{
                                functionResponse: {
                                    name: matchingCall.name,
                                    response: { output: result }
                                }
                            }];
                        }
                    }
                }
            }

            // Gemini APIは user/gemini(model) が交互である必要はないが、CLIの再開機構に乗せる構造を作る
            resumedSessionData = {
                conversation: {
                    sessionId: sessionKey || 'default',
                    startTime: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    messages: geminiMessages
                },
                filePath: 'memory-injected'
            };
        }

        // 1. プールからRunnerプロセスを取得（またはキュー待ち）
        const runner = await runnerPool.acquireRunner({
            input: prompt,
            promptId: requestId,
            resumedSessionData,
            model: model,
            env: env,
            mediaPaths: mediaPaths
        });

        // --- Abort ハンドル: 外部（server.js）から Runner を停止するためのインターフェース ---
        let aborted = false;
        killRunner = () => {
            if (aborted) return;
            aborted = true;
            log('[abort] Client disconnected. Killing runner process.');
            try { runner.kill('SIGTERM'); } catch (_) { }
            setTimeout(() => { try { runner.kill('SIGKILL'); } catch (_) { } }, 3000);
        };

        // Runner が正常終了した場合は aborted フラグを立てて二重 kill を防止
        runner.on('close', () => { aborted = true; });

        let buffer = '';
        let fullText = '';
        let lastWasTool = false; // SSoT 4.2: ツールと地の文の間に改行を入れるための状態管理

        // --- SSoT 5.0: IPC によるイベント受信 ---
        
        runner.on('message', (msg) => {
            if (msg.type !== 'gemini_event') return;
            const event = msg.event;
            
            switch (event.type) {
                case 'content': {
                    if (!event.value) break;
                    if (!perfFirstToken) {
                        perfFirstToken = Date.now();
                        log(`[perf] Time To First Token: ${((perfFirstToken - perfStart) / 1000).toFixed(2)}s`);
                    }
                    fullText += event.value;
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: event.value },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                case 'thought': {
                    // SSoT 6.0: 思考プロセスを reasoning_content として送出（装飾なし）
                    if (!event.value) break;
                    const thoughtText = event.value.description || event.value.subject || '';
                    if (!thoughtText) break;
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { reasoning_content: thoughtText },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                case 'tool_call_request': {
                    // SSoT 6.0: ツールマーカー ID 方式
                    // (a) 実データをアダプター側メモリに保存
                    // (b) OpenClaw に ⚙️ tooluse[name][callId] マーカーを content として送出
                    // ※ tool_calls フィールドは一切送出しない（インターセプト完全回避）
                    if (!event.value) break;
                    const tc = event.value;
                    const tcCallId = tc.callId || tc.id || randomId();
                    const tcName = tc.name || 'unknown';
                    
                    // セッション単位でツールデータを保存
                    const sessionStore = getSessionStore(sessionKey);
                    sessionStore.set(tcCallId, { name: tcName, args: tc.args || {}, result: null });
                    log(`[tool-store] Stored tool_call_request: ${tcName} [${tcCallId}]`);
                    
                    // UI 表示用マーカーを content に挿入
                    const marker = `\n⚙️ tooluse[${tcName}][${tcCallId}]\n`;
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: marker },
                            finish_reason: null
                        }]
                    });
                    const { callId, name, args } = event.value;
                    log(`[adapter] [tool-store] Stored tool_call_request: ${name} [${callId}]`);
                    
                    // SSoT 6.1: ファイル永続化
                    storeToolContext(sessionKey, callId, { name, args, result: null });

                    // OpenClaw UI 向けのマーカーを送出
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: `\n⚙️ tooluse[${name}][${callId}]\n` },
                            finish_reason: null
                        }]
                    });
                    break;
                }

                case 'tool_result': {
                    const { callId, name, result } = event.value;
                    log(`[adapter] [tool-store] Stored tool_result: ${name} [${callId}]`);
                    
                    // SSoT 6.1: 結果を追記してファイル永続化
                    storeToolContext(sessionKey, callId, { result });
                    break;
                }
                
                case 'finished': {
                    // finish_reason を送出（ただしプロセス終了時の close イベントでも送るため、二重送信に注意）
                    break;
                }
                
                case 'error': {
                    const errMsg = event.value?.error?.message || JSON.stringify(event.value);
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: `\n⚠️ [Gemini Error] ${errMsg}` },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                case 'loop_detected': {
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: '\n⚠️ Loop detected, stopping execution.' },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                case 'agent_execution_stopped': {
                    const reason = event.value?.systemMessage || event.value?.reason || 'stopped';
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'gemini',
                        choices: [{
                            index: 0,
                            delta: { content: `\n🛑 Agent stopped: ${reason}` },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                default:
                    log(`[ipc] Unhandled gemini_event type: ${event.type}`);
                    break;
            }
        });

        // --- SSoT 5.0: stdout は IPC に移行したためログ出力のみ ---
        runner.stdout.on('data', chunk => {
            const raw = chunk.toString('utf-8');
            log(`[stdout-passthrough] ${raw.substring(0, 200)}`);
        });

        let stderr = '';
        runner.stderr.on('data', chunk => { stderr += chunk.toString('utf-8'); });

        // 3. プロセスが終了したら完了レスポンスを送る
        runner.on('close', (code, signal) => {
            const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
            log(`[perf] Runner process closed with code ${code}, signal ${signal}. Total duration: ${totalDur}s`);
            if (stderr.trim()) log(`Runner stderr: ${stderr.trim().substring(0, 300)}`);

            // Send completion chunk
            sseWrite(res, {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini',
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            });
            res.write('data: [DONE]\n\n');
            res.end();
        });

        runner.on('error', err => {
            log(`Runner process stream error: ${err.message}`);
            sseWrite(res, {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini',
                choices: [{
                    index: 0,
                    delta: { content: `\n⚠️ Runner failed: ${err.message}` },
                    finish_reason: 'error'
                }]
            });
            res.write('data: [DONE]\n\n');
            res.end();
        });

    } catch (err) {
        log(`[adapter] Error starting runner: ${err.message}`);
        sseWrite(res, {
            id: responseId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini',
            choices: [{
                index: 0,
                delta: { content: `\n⚠️ Pool Error: ${err.message}` },
                finish_reason: 'error'
            }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
    }

    // server.js側から req.on('close') 経由で呼ばれる kill ハンドルを返す
    return { kill: killRunner };
}

module.exports = { prepareGeminiEnv, runGeminiStreaming };
