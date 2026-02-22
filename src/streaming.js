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
const geminiBinPath = path.join(__dir, 'node_modules', '.bin', 'gemini');

// Bun優先: Bunが利用可能ならBun経由でGemini CLIを起動（高速起動）
const { execSync } = require('child_process');
let useBun = false;
try { execSync('bun --version', { stdio: 'ignore' }); useBun = true; } catch (_) {}

let commandToRun, commandArgs;
if (useBun && fs.existsSync(geminiBinPath)) {
    commandToRun = 'bun';
    commandArgs  = [geminiBinPath];
    log('Runtime: Bun (gemini via bun)');
} else if (fs.existsSync(geminiBinPath)) {
    commandToRun = geminiBinPath;
    commandArgs  = [];
    log('Runtime: Node.js (gemini direct)');
} else {
    commandToRun = 'gemini';
    commandArgs  = [];
    log('Runtime: system gemini');
}

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

/**
 * Spawn Gemini CLI with the provided prompt and optional --resume session,
 * streaming output back as OpenAI-compatible SSE chunks.
 */
async function runGeminiStreaming({ prompt, messages, model, sessionName, mediaPaths, env, res, requestId, onSessionId, sessionKey }) {
    const reqModel = model || 'auto-gemini-3';
    const geminiArgs = ['--yolo', '--allowed-mcp-server-names', 'openclaw-tools', '-o', 'stream-json', '--model', reqModel];

    const responseId = `resp_${requestId}`;

    if (global.useFallbackSpawn) {
        log(`[fallback] Using legacy spawn mode for request ${requestId}`);
        return runGeminiStreamingFallback(geminiArgs, env, res, responseId, onSessionId, sessionKey, perfStart);
    }

    // Performance profiling markers
    const perfStart = Date.now();
    let perfFirstToken = null;
    const perfTools = {};

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

        const { generateContentDirect } = await import('./gemini-core-facade.js');
        const abortController = new AbortController();
        
        let fullText = '';

        try {
            // Transform OpenAI-compatible messages to Gemini-compatible Contents
            const reqMessages = messages && messages.length > 0 ? messages : [{ role: 'user', content: prompt }];
            let formattedContents = reqMessages.map(msg => {
                // OpenAI 'assistant' -> Gemini 'model'
                const role = msg.role === 'assistant' ? 'model' : (msg.role === 'system' ? 'user' : 'user');
                let text = '';
                
                if (typeof msg.content === 'string') {
                    text = msg.content;
                } else if (Array.isArray(msg.content)) {
                    text = msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                }
                
                return { role, parts: [{ text }] };
            });

            // Gemini API requires alternating user/model roles.
            // If there are consecutive 'user' or 'model' roles, we need to merge them to prevent API errors.
            const mergedContents = [];
            for (const content of formattedContents) {
                if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === content.role) {
                    mergedContents[mergedContents.length - 1].parts[0].text += '\n\n' + content.parts[0].text;
                } else {
                    mergedContents.push({
                        role: content.role,
                        parts: [{ text: content.parts[0].text }]
                    });
                }
            }
            
            // Ensure the last message is always from 'user'
            if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role !== 'user') {
                 mergedContents.push({ role: 'user', parts: [{ text: 'Please continue.' }] });
            }

            const response = await generateContentDirect(
                requestId,
                mergedContents,
                reqModel,
                abortController.signal
            );
            
            fullText = response.text;
            
            // 一括で受け取った結果をSSEとして吐き出す
            sseWrite(res, {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini',
                choices: [{
                    index: 0,
                    delta: { content: fullText },
                    finish_reason: null
                }]
            });
            
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
            const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
            log(`[perf] Gemini API call completed directly. Total duration: ${totalDur}s`);

        } catch (err) {
            log(`Gemini CLI failed: ${err.message}`);
            sseWrite(res, {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini',
                choices: [{
                    index: 0,
                    delta: { content: `\n⚠️ Gemini CLI API failed: ${err.message}` },
                    finish_reason: 'error'
                }]
            });
            res.write('data: [DONE]\n\n');
            res.end();
        }
}

/**
 * フォールバック用の従来の spawn を使った外部プロセス呼び出し
 */
function runGeminiStreamingFallback(geminiArgs, env, res, responseId, onSessionId, sessionKey, perfStart) {
    const finalArgs = [...commandArgs, ...geminiArgs];
    log(`spawn (fallback): ${commandToRun} ${finalArgs.slice(0, 4).join(' ')} ...`);

    const geminiProcess = spawn(commandToRun, finalArgs, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let fullText = '';
    const collectedTools = [];
    let perfFirstToken = null;
    const perfTools = {};

    geminiProcess.stdout.on('data', chunk => {
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
                    if (json.content || (json.role === 'assistant' && json.content)) {
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
    geminiProcess.stderr.on('data', chunk => { stderr += chunk.toString('utf-8'); });

    geminiProcess.on('close', code => {
        const totalDur = ((Date.now() - perfStart) / 1000).toFixed(2);
        log(`[perf] Gemini CLI fallback process closed with code ${code}. Total duration: ${totalDur}s`);
        if (stderr.trim()) log(`Gemini CLI stderr: ${stderr.trim().substring(0, 300)}`);

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

    geminiProcess.on('error', err => {
        log(`Gemini CLI fallback failed to start: ${err.message}`);
        sseWrite(res, {
            id: responseId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini',
            choices: [{
                index: 0,
                delta: { content: `\n⚠️ Gemini CLI failed to start in fallback mode: ${err.message}` },
                finish_reason: 'error'
            }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
    });

    const timeout = setTimeout(() => {
        log(`[perf] Gemini CLI fallback timed out`);
        geminiProcess.kill('SIGTERM');
        res.write('data: [DONE]\n\n');
        res.end();
    }, GEMINI_TIMEOUT_MS);

    geminiProcess.on('close', () => clearTimeout(timeout));
}

module.exports = { prepareGeminiEnv, runGeminiStreaming };
