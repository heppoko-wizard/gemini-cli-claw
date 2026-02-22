#!/usr/bin/env node

'use strict';

/**
 * gemini-cli-claw / server.js
 *
 * OpenAI-compatible HTTP server that bridges OpenClaw's embedded agent path
 * (runEmbeddedPiAgent) to Google's Gemini CLI tool.
 */

const fs   = require('fs');
const http = require('http');
const { log, randomId } = require('./utils');
const { extractText, convertToGeminiMessages } = require('./converter');
const { loadSessionMap, saveSessionMap, overwriteSessionHistory } = require('./session');
const { prepareGeminiEnv, runGeminiStreaming } = require('./streaming');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = process.env.GEMINI_ADAPTER_PORT
    ? parseInt(process.env.GEMINI_ADAPTER_PORT, 10)
    : 3972;

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON body')); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    log(`Incoming request: ${req.method} ${url.pathname}`);
    if (req.method === 'POST') log(`Headers: ${JSON.stringify(req.headers)}`);

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', adapter: 'gemini-cli-claw' }));
        return;
    }

    // Models endpoint (OpenClaw probes this)
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            object: 'list',
            data: [{ id: 'gemini', object: 'model', owned_by: 'google' }],
        }));
        return;
    }

    // Chat completions
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions' || url.pathname === '/responses')) {
        let body;
        try {
            body = await readBody(req);
            fs.writeFileSync('/tmp/adapter_last_req.json', JSON.stringify(body, null, 2), 'utf-8');
            log(`Request body saved to /tmp/adapter_last_req.json. Num messages: ${(body.input || body.messages || []).length}`);
        }
        catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
            return;
        }

        const messages    = body.messages || body.input || [];
        const stream      = body.stream !== false;
        const sessionKey  = body._openclawSessionKey || body._sessionId || 'default';
        const workspaceDir = body._workspaceDir || process.cwd();
        const reqModel     = body.model || 'auto-gemini-3';

        // Extract system prompt from the messages array
        const systemMsg = messages.find(m => m.role === 'system');
        const systemPrompt = systemMsg ? extractText(systemMsg.content) : '';

        // Extract image paths from the last user message
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const lastUserText = lastUserMsg ? extractText(lastUserMsg.content) : '';

        const mediaPaths = [];
        const mediaAttachedPattern = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;
        let mMatch;
        while ((mMatch = mediaAttachedPattern.exec(lastUserText)) !== null) {
            const content = mMatch[1];
            if (/^\d+\s+files?$/i.test(content.trim())) continue;
            const pathMatch = content.match(/^\s*(.+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif))\s*(?:\(|$|\|)/i);
            if (pathMatch && pathMatch[1]) mediaPaths.push(pathMatch[1].trim());
        }

        // Separate history from the prompt
        const lastUserIdx = messages.findLastIndex ? messages.findLastIndex(m => m.role === 'user')
            : (() => { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') return i; } return -1; })();

        const historyMessages = lastUserIdx > 0 ? messages.slice(0, lastUserIdx) : [];
        const promptText = lastUserText.replace(/\[media attached[^\]]*\]/gi, '').trim();

        // Set up Gemini environment
        let env, chatsDir, tempSystemMdPath;
        try {
            ({ env, chatsDir, tempSystemMdPath } = prepareGeminiEnv({ sessionKey, workspaceDir, systemPrompt }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to prepare Gemini env: ${e.message}` }));
            return;
        }

        // Look up existing Gemini session ID for this OpenClaw session
        const sessionMap = loadSessionMap();
        let geminiSessionId = sessionMap[sessionKey] || null;

        // If we have an existing Gemini session AND history, overwrite its messages
        if (geminiSessionId && historyMessages.length > 0) {
            try {
                const newMessages = convertToGeminiMessages(historyMessages);
                const ok = overwriteSessionHistory(chatsDir, geminiSessionId, newMessages);
                if (ok) {
                    log(`overwrote session ${geminiSessionId} with ${historyMessages.length} pruned msgs`);
                } else {
                    log(`session file for ${geminiSessionId} not found — starting fresh`);
                    geminiSessionId = null;
                }
            } catch (e) {
                log(`Failed to overwrite session: ${e.message} — starting fresh`);
                geminiSessionId = null;
            }
        }

        const requestId = randomId();

        if (stream) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            runGeminiStreaming({
                prompt: promptText,
                messages: historyMessages.concat(messages.slice(lastUserIdx)),
                model: reqModel,
                sessionName: geminiSessionId,
                mediaPaths,
                env,
                res,
                requestId,
                onSessionId: (capturedId) => {
                    const map = loadSessionMap();
                    map[sessionKey] = capturedId;
                    saveSessionMap(map);
                    log(`captured session_id: ${capturedId} for key: ${sessionKey}`);
                },
                sessionKey,
            });

            res.on('close', () => {
                try { fs.rmSync(tempSystemMdPath); } catch (_) {}
            });
        } else {
            // Non-streaming: collect all output then respond
            let fullText = '';
            const fakeRes = {
                write: (chunk) => {
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                        try {
                            const ev = JSON.parse(line.slice(6));
                            fullText += ev.choices?.[0]?.delta?.content || '';
                        } catch (_) {}
                    }
                },
                end: () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        id: `chatcmpl-${requestId}`,
                        object: 'chat.completion',
                        choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
                    }));
                    try { fs.rmSync(tempSystemMdPath); } catch (_) {}
                },
                on: () => {},
            };
            runGeminiStreaming({
                prompt: promptText,
                messages: historyMessages.concat(messages.slice(lastUserIdx)),
                model: reqModel,
                sessionName: geminiSessionId,
                mediaPaths,
                env,
                res: fakeRes,
                requestId,
                onSessionId: (capturedId) => {
                    const map = loadSessionMap();
                    map[sessionKey] = capturedId;
                    saveSessionMap(map);
                },
                sessionKey,
            });
        }
        return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// グローバルなフォールバックフラグの定義（streaming.js等で参照する）
global.useFallbackSpawn = false;

(async () => {
    let initializeGeminiCore;
    try {
        const facade = await import('./gemini-core-facade.js');
        initializeGeminiCore = facade.initializeGeminiCore;
    } catch (err) {
        console.error("Failed to load gemini-core-facade.js", err);
        process.exit(1);
    }
    try {
        log('Initializing Gemini Core... This may take up to 15 seconds.');
        await initializeGeminiCore();
        log('Gemini Core initialized successfully.');
    } catch (err) {
        log(`Failed to initialize Gemini Core: ${err.message}. Enabling fallback spawn mode.`);
        global.useFallbackSpawn = true;
    }

    server.listen(PORT, () => {
        log(`Gemini CLI adapter listening on port ${PORT}`);
    });
})();

server.on('error', err => {
    console.error('[adapter] Server error:', err.message);
    process.exit(1);
});
