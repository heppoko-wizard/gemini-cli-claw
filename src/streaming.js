'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { log, randomId, sseWrite } = require('./utils');
const { injectToolHistoryIntoOpenClaw } = require('./injector');

// ---------------------------------------------------------------------------
// Gemini CLI discovery
// ---------------------------------------------------------------------------

const __dir = path.resolve(__dirname, '..');

const GEMINI_TIMEOUT_MS = 180_000; // 3 minutes

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
    const homeBaseDir  = path.join(os.homedir(), '.openclaw', 'gemini-sessions');
    const tempHomeDir  = path.join(homeBaseDir, sessionKey);
    const tempGeminiDir = path.join(tempHomeDir, '.gemini');
    const chatsDir = path.join(tempGeminiDir, 'tmp', 'gemini-cli-claw', 'chats');

    fs.mkdirSync(chatsDir, { recursive: true });

    // --- settings.json with MCP server injection ---
    const realGeminiDir  = path.join(os.homedir(), '.gemini');
    const realSettingsPath = path.join(realGeminiDir, 'settings.json');
    let userSettings = {};
    try {
        if (fs.existsSync(realSettingsPath)) {
            userSettings = JSON.parse(fs.readFileSync(realSettingsPath, 'utf-8'));
        }
    } catch (_) {}

    userSettings.mcpServers = userSettings.mcpServers || {};
    userSettings.mcpServers['openclaw-tools'] = {
        command: 'node',
        args: [path.join(__dir, 'mcp-server.mjs'), sessionKey, workspaceDir || process.cwd()],
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
        try { fs.copyFileSync(src, path.join(tempGeminiDir, file)); } catch (_) {}
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

    try {
        log(`[adapter] Acquiring runner for sessionKey: ${sessionKey}`);
        
        // 履歴をGemini CLIの内部SessionData形式に合成する
        let resumedSessionData = undefined;
        if (messages && messages.length > 0) {
            const geminiMessages = messages.map(msg => {
                let text = '';
                if (typeof msg.content === 'string') {
                    text = msg.content;
                } else if (Array.isArray(msg.content)) {
                    text = msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                }
                return {
                    type: msg.role === 'assistant' ? 'gemini' : 'user',
                    content: [{ text: text }]
                };
            });
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

        let buffer = '';
        let fullText = '';

        // 2. 標準出力をパースし、SSEでストリーミング
        runner.stdout.on('data', chunk => {
            const raw = chunk.toString('utf-8');
            log(`[stdout] ${raw.substring(0, 200)}`);
            buffer += raw;

            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const line = buffer.substring(0, boundary).trim();
                buffer = buffer.substring(boundary + 1);
                boundary = buffer.indexOf('\n');

                if (!line) continue;

                let json;
                try { json = JSON.parse(line); } catch (_) { continue; }

                switch (json.type) {
                    case 'init':
                    case 'result':
                        if (json.session_id && onSessionId) {
                            onSessionId(json.session_id);
                        }
                        break;

                    case 'stream':
                    case 'message':
                        // Gemini CLIの stream-json は 'user' メッセージもダンプするため、AIの返答のみを抽出
                        if (json.role === 'assistant' || json.role === 'model') {
                            if (json.content) {
                                if (!perfFirstToken) {
                                    perfFirstToken = Date.now();
                                    log(`[perf] Time To First Token: ${((perfFirstToken - perfStart) / 1000).toFixed(2)}s`);
                                }
                                fullText += json.content;
                                sseWrite(res, {
                                    id: responseId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: 'gemini',
                                    choices: [{
                                        index: 0,
                                        delta: { content: json.content },
                                        finish_reason: null
                                    }]
                                });
                            }
                        }
                        break;

                    case 'tool_use':
                        // ツール使用開始の通知（プレースホルダー的なUI用）
                        sseWrite(res, {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: 'gemini',
                            choices: [{
                                index: 0,
                                delta: { content: `\n\n⚙️ Using tool [${json.tool_name}] ...\n` },
                                finish_reason: null
                            }]
                        });
                        break;

                    case 'tool_result':
                        // ツール実行結果の通知
                        const statusIcon = json.status === 'success' ? '✅' : '❌';
                        sseWrite(res, {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: 'gemini',
                            choices: [{
                                index: 0,
                                delta: { content: `${statusIcon} Tool finished.\n\n` },
                                finish_reason: null
                            }]
                        });
                        break;

                    case 'error':
                        sseWrite(res, {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: 'gemini',
                            choices: [{
                                index: 0,
                                delta: { content: `\n⚠️ ${json.message || JSON.stringify(json)}` },
                                finish_reason: null
                            }]
                        });
                        break;
                }
            }
        });

        let stderr = '';
        runner.stderr.on('data', chunk => { stderr += chunk.toString('utf-8'); });

        // 3. プロセスが終了したら完了レスポンスを送る
        runner.on('close', code => {
            const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
            log(`[perf] Runner process closed with code ${code}. Total duration: ${totalDur}s`);
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
}

module.exports = { prepareGeminiEnv, runGeminiStreaming };
