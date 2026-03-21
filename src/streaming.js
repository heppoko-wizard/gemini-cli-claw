'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, debug, randomId, sseWrite } = require('./utils');

// ---------------------------------------------------------------------------
// SSoT 6.0: ツールコンテキストストア
// tool_call_request/tool_result の実データをアダプター側で保持する。
// OpenClaw には軽量マーカー（⚙️ tooluse[name][callId]）のみを送出する。
// 次ターンの履歴受信時に callId を使ってリハイドレートし、
// Gemini CLI 向けの正規 toolCalls 構造に復元する。
// ---------------------------------------------------------------------------

const CONTEXT_BASE_DIR = process.env.CONTEXT_BASE_DIR || path.join(__dirname, '../logs/contexts');

/**
 * ツール情報をファイルに保存する
 */
function storeToolContext(sessionKey, callId, data) {
    const sessionDir = path.join(CONTEXT_BASE_DIR, sessionKey);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    let existing = {};
    const filePath = path.join(sessionDir, `${callId}.json`);
    
    try {
        if (fs.existsSync(filePath)) {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {
        // ignore parse error for existing file
    }

    const updated = { ...existing, ...data };
    
    try {
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
        log(`[tool-store] Persisted context: ${sessionKey}/${callId}.json`);
    } catch (e) {
        log(`[tool-store] ERROR persisting context: ${e.message}`);
    }
}

/**
 * ツール情報をファイルからロードする
 */
function loadToolContext(sessionKey, callId) {
    try {
        const filePath = path.join(CONTEXT_BASE_DIR, sessionKey, `${callId}.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            log(`[tool-store] Loaded context from file: ${sessionKey}/${callId}.json`);
            return data;
        }
    } catch (e) {
        log(`[tool-store] ERROR loading context from file: ${e.message}`);
    }
    return null;
}



// ---------------------------------------------------------------------------
// Gemini CLI runner (streaming → SSE)
// ---------------------------------------------------------------------------

const { runnerPool } = require('./runner-pool.js');

/**
 * Spawn Gemini CLI with the provided prompt and optional --resume session,
 * streaming output back as OpenAI-compatible SSE chunks via RunnerPool.
 */
async function runGeminiStreaming({ prompt, messages, model, sessionName, mediaPaths, systemMdPath, res, requestId, onSessionId, sessionKey }) {
    const responseId = `resp_${requestId}`;
    const perfStart = Date.now();
    let perfFirstToken = null;

    // Send initial completions chunk
    sseWrite(res, {
        id: responseId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null
        }]
    });

    // killRunner は try ブロック内で runner 取得後に代入される
    let killRunner = null;
    let stderr = '';

    try {
        const rehydrateStart = Date.now();
        log(`[adapter] Acquiring runner for sessionKey: ${sessionKey}`);

        // 履歴をGemini CLIの内部SessionData形式に合成する (SSoT 3.0)
        let resumedSessionData = undefined;
        if (messages && messages.length > 0) {
            const geminiMessages = [];
            const timestamp = new Date().toISOString();

            // SSoT 6.0: ツールマーカー検出正規表現
            const TOOL_MARKER_RE = /\n?⚙️ tooluse\[([^\]]+)\]\[([^\]]+)\]\n?/g;

            // SSoT: Fix double-inbound (message duplication)
            // The last message in the OpenClaw array is the *current* user prompt.
            // Since we call sendMessageStream(prompt) separately, we MUST remove it 
            // from the resume history to prevent it from appearing twice in Gemini's context.
            const historyOnly = (messages[messages.length - 1]?.role === 'user')
                ? messages.slice(0, -1)
                : messages;

            for (const msg of historyOnly) {
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
                    const toolCalls = [];
                    const functionParts = [];
                    let cleanText = text;
                    let match;
                    TOOL_MARKER_RE.lastIndex = 0;

                    while ((match = TOOL_MARKER_RE.exec(text)) !== null) {
                        const [fullMatch, markerName, markerCallId] = match;
                        const stored = loadToolContext(sessionKey, markerCallId);
                        
                        // 400エラー対策: 常に tool_call と function_response のペアを作る
                        const callId = markerCallId;
                        const toolName = stored ? stored.name : markerName;
                        const toolArgs = stored ? stored.args : {};
                        const toolResult = stored ? (stored.result || "(No result captured)") : "(No history found for this tool)";

                        log(`[history] Rehydrating tool turn: ${toolName} [${callId}]`);
                        
                        toolCalls.push({
                            id: callId,
                            name: toolName,
                            args: toolArgs
                        });

                        functionParts.push({
                            functionResponse: {
                                name: toolName,
                                response: { 
                                    output: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                                }
                            }
                        });

                        cleanText = cleanText.replace(fullMatch, '');
                    }

                    if (toolCalls.length > 0) {
                        // 1. Tool Call Turn (Model)
                        geminiMessages.push({
                            type: 'gemini',
                            content: [{ text: "" }], // ツール呼び出し時のテキストは空または最小限にする
                            toolCalls: toolCalls
                        });

                        // 2. Tool Response Turn (Function)
                        geminiMessages.push({
                            type: 'function',
                            parts: functionParts
                        });

                        // 3. Final Assistant Text Turn (If any)
                        if (cleanText.trim()) {
                            geminiMessages.push({
                                type: 'gemini',
                                content: [{ text: cleanText.trim() }]
                            });
                        }
                    } else {
                        // 通常のアシスタントメッセージ
                        geminiMessages.push({
                            type: 'gemini',
                            content: [{ text: text.trim() }]
                        });
                    }
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
            log(`[history] Final resumedSessionData structure (first 2000 chars): ${JSON.stringify(resumedSessionData).substring(0, 2000)}`);
        }
        debug(`[perf] History rehydration (SSoT) took ${Date.now() - rehydrateStart}ms for ${messages.length} messages.`);

        // 1. プールからRunnerプロセスを取得（またはキュー待ち）
        const poolAcquireStart = Date.now();
        const runner = await runnerPool.acquireRunner({
            input: prompt,
            promptId: requestId,
            resumedSessionData,
            model: model,
            systemMdPath: systemMdPath,
            sessionKey: sessionKey,
            mediaPaths: mediaPaths
        });
        debug(`[perf] Runner acquisition from pool took ${Date.now() - poolAcquireStart}ms`);

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
        
        let isFinished = false;

        const messageHandler = (msg) => {
            if (msg.type === 'run_complete') {
                if (isFinished) return;
                isFinished = true;
                const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
                log(`[perf] Runner finished execution. Total duration: ${totalDur}s`);
                
                sseWrite(res, {
                    id: responseId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                });
                res.write('data: [DONE]\n\n');
                res.end();
                
                runner.removeListener('message', messageHandler);
                runner.stdout.removeListener('data', stdoutHandler);
                runner.stderr.removeListener('data', stderrHandler);
                runnerPool.releaseRunner(runner);
                return;
            }

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
                        model: model,
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
                        model: model,
                        choices: [{
                            index: 0,
                            delta: { reasoning_content: thoughtText },
                            finish_reason: null
                        }]
                    });
                    break;
                }
                
                case 'tool_call_request': {
                    // SSoT 6.0/6.1: ツールマーカー ID 方式 (統合済み)
                    // 1. 実データをアダプター側（ファイル）に保存
                    // 2. OpenClaw に ⚙️ tooluse[name][callId] マーカーのみを content として送出
                    // ※ tool_calls フィールドは一切送出しない（インターセプト完全回避）
                    if (!event.value) break;
                    const tc = event.value;
                    const callId = tc.callId || tc.id || randomId();
                    const name = tc.name || 'unknown';
                    const args = tc.args || {};
                    
                    // (b) ファイル永続化 (SSoT 6.1)
                    storeToolContext(sessionKey, callId, { name, args, result: null });
                    log(`[tool-store] Stored tool_call_request: ${name} [${callId}]`);
                    
                    // (c) OpenClaw UI 向けマーカーを content に挿入（1回のみ）
                    const marker = `\n⚙️ tooluse[${name}][${callId}]\n`;
                    sseWrite(res, {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [{
                            index: 0,
                            delta: { content: marker },
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
                        model: model,
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
                        model: model,
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
                        model: model,
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
        };

        runner.on('message', messageHandler);

        let stdoutBuffer = '';
        const stdoutHandler = chunk => {
            const raw = chunk.toString('utf-8');
            stdoutBuffer += raw;
            
            let lineEnd;
            while ((lineEnd = stdoutBuffer.indexOf('\n')) !== -1) {
                const line = stdoutBuffer.substring(0, lineEnd).trim();
                stdoutBuffer = stdoutBuffer.substring(lineEnd + 1);
                
                if (line.startsWith('{') && line.endsWith('}')) {
                    try {
                        const event = JSON.parse(line);
                        // SSoT 6.5: stdout からのツール結果捕捉。
                        // Gemini CLI Core はフラットなスキーマ (tool_id, output) を吐き出す。
                        if (event.type === 'tool_result') {
                            const callId = event.tool_id || (event.value && event.value.callId);
                            const result = event.output || (event.value && event.value.result);
                            if (callId) {
                                log(`[adapter] [tool-store] Captured tool_result from stdout: ${callId}`);
                                storeToolContext(sessionKey, callId, { result });
                            }
                        }
                    } catch (_) {
                        // JSON パースエラーは無視して通常のパススルーへ
                    }
                }
            }
            log(`[stdout-passthrough] ${raw.substring(0, 200)}`);
        };

        const stderrHandler = chunk => {
            const raw = chunk.toString('utf-8');
            stderr += raw;
            if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
                process.stderr.write(`[Runner:stderr] ${raw}`);
            }
        };

        runner.stdout.on('data', stdoutHandler);
        runner.stderr.on('data', stderrHandler);

        // 3. プロセスが例外終了したらフェイルセーフとして完了レスポンスを送る
        runner.on('close', (code, signal) => {
            runner.removeListener('message', messageHandler);
            runner.stdout.removeListener('data', stdoutHandler);
            runner.stderr.removeListener('data', stderrHandler);
            if (isFinished) {
                log(`[pool] Runner process closed (code: ${code}, signal: ${signal}).`);
                return;
            }
            isFinished = true;

            const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
            log(`[perf] Runner process closed unexpectedly with code ${code}, signal ${signal}. Total duration: ${totalDur}s`);
            if (stderr.trim()) log(`Runner stderr: ${stderr.trim().substring(0, 300)}`);

            // Send completion chunk
            sseWrite(res, {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
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

module.exports = { runGeminiStreaming };
