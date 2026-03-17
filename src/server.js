#!/usr/bin/env node

'use strict';

/**
 * openclaw-gemini-cli-adapter / server.js
 *
 * OpenAI-compatible HTTP server that bridges OpenClaw's embedded agent path
 * (runEmbeddedPiAgent) to Google's Gemini CLI tool.
 */

const fs = require('fs');
const http = require('http');
const { log, debug, randomId, sseWrite } = require('./utils');
const { saveBase64Image } = require('./media');
const { extractText } = require('./converter');
const { loadSessionMap, saveSessionMap } = require('./session');
const { runGeminiStreaming } = require('./streaming');

// ---------------------------------------------------------------------------
// Summarization intercept
// ---------------------------------------------------------------------------

/**
 * Detect if the incoming request is a summarization/compaction request from
 * the OpenClaw Gateway.  These requests carry a distinctive system prompt and
 * XML-like tags that we can match with high confidence.
 *
 * Returning true means "this is a summarization request — do NOT forward it
 * to Gemini CLI; reply with a canned summary instead".
 */
function isSummarizationRequest(systemPrompt, userText) {
    // Primary signal: the system prompt used by pi-coding-agent's compaction module
    if (systemPrompt && systemPrompt.includes('You are a context summarization assistant')) {
        return true;
    }
    // Secondary signal: XML tags wrapping serialized conversation history
    if (userText && userText.includes('<conversation>') && (
        userText.includes('<previous-summary>') ||
        userText.includes('## Goal') ||
        userText.includes('structured context checkpoint summary') ||
        userText.includes('state_snapshot')
    )) {
        return true;
    }
    // Tertiary: text_to_summarize tag (used by summarizeText)
    if (userText && userText.includes('<text_to_summarize>')) {
        return true;
    }
    // Additional heuristics
    if (systemPrompt && (
        systemPrompt.includes('structured context checkpoint summary') ||
        systemPrompt.includes('state_snapshot')
    )) {
        return true;
    }
    return false;
}

/**
 * Send a canned summarization response so OpenClaw believes the summary
 * succeeded, while the real context is safely managed by Gemini CLI's own
 * compaction / <state_snapshot> mechanism.
 */
/*
function sendFakeSummaryResponse(res, requestId, stream) {
    const summary = `## Goal\nContinuing the current task as directed by the user.\n\n## Constraints & Preferences\n- (managed by the agent\'s internal memory)\n\n## Progress\n### Done\n- [x] Previous context has been preserved by the agent\'s native memory management.\n\n### In Progress\n- [ ] Awaiting next user instruction.\n\n## Key Decisions\n- Context compaction is handled internally by the agent.\n\n## Next Steps\n1. Continue with the user\'s next request.\n\n## Critical Context\n- Full conversation history is maintained by the agent\'s session.`;

    if (stream) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        sseWrite(res, {
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini',
            choices: [{ index: 0, delta: { role: 'assistant', content: summary }, finish_reason: null }]
        });
        sseWrite(res, {
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: summary }, finish_reason: 'stop' }],
        }));
    }
}
*/

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
        const chunks = [];
        req.on('data', chunk => { chunks.push(chunk); });
        req.on('end', () => {
            try {
                const rawBuffer = Buffer.concat(chunks);
                fs.writeFileSync(require('path').join(__dirname, '../logs/raw_req.bin'), rawBuffer);
                const data = rawBuffer.toString('utf8');
                resolve(JSON.parse(data));
            }
            catch (e) { reject(new Error('Invalid JSON body')); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const reqStart = Date.now();
    const url = new URL(req.url, `http://localhost:${PORT}`);
    log(`Incoming request: ${req.method} ${url.pathname}`);
    if (req.method === 'POST') log(`Headers: ${JSON.stringify(req.headers)}`);

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', adapter: 'openclaw-gemini-cli-adapter' }));
        return;
    }

    // Models endpoint (OpenClaw probes this)
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });

        let modelsList = [{ id: 'gemini', object: 'model', owned_by: 'google' }];
        try {
            const core = require('@google/gemini-cli-core');
            if (core.VALID_GEMINI_MODELS) {
                modelsList = Array.from(core.VALID_GEMINI_MODELS).map(m => ({
                    id: m,
                    object: 'model',
                    owned_by: 'google'
                }));
                // Also add aliases
                modelsList.push({ id: 'auto-gemini-3', object: 'model', owned_by: 'google' });
                modelsList.push({ id: 'auto-gemini-2.5', object: 'model', owned_by: 'google' });
            }
        } catch (e) {
            log(`[models] Failed to load dynamic models from core: ${e.message}`);
        }

        res.end(JSON.stringify({
            object: 'list',
            data: modelsList,
        }));
        return;
    }

    // Chat completions
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions' || url.pathname === '/responses')) {
        let body;
        try {
            body = await readBody(req);
            const logPath = require('path').join(__dirname, '../logs/adapter_last_req.json');
            const logDir = require('path').dirname(logPath);
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            fs.writeFileSync(logPath, JSON.stringify(body, null, 2), 'utf-8');
            log(`Request body saved to logs/adapter_last_req.json. Num messages: ${(body.input || body.messages || []).length}`);
        }
        catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
            return;
        }

        const messages = body.messages || body.input || [];

        // ---------------------------------------------------------------
        // History Cleansing (Gemini 429 Guard)
        // ---------------------------------------------------------------
        // Remove trailing Gemini API errors from assistant messages to 
        // prevent error accumulation and quota exhaustion.
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.content) {
                let contentStr = '';
                let isArray = false;
                if (typeof msg.content === 'string') {
                    contentStr = msg.content;
                } else if (Array.isArray(msg.content)) {
                    contentStr = msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                    isArray = true;
                }
                
                // SSoT 6.0: 旧 SSoT 5.1 形式の装飾ログ（⚙️ **toolname**\n```json...```）を除去
                // ※ 新方式の ⚙️ tooluse[name][id] マーカーは保持する
                const legacyToolLogRE = /\n?⚙️ \*\*[^*]+\*\*\n```json[\s\S]*?```/g;
                let cleanStr = contentStr.replace(legacyToolLogRE, '');
                if (cleanStr !== contentStr) {
                    if (cleanStr.trim() === '') {
                        messages.splice(i, 1);
                        log(`[adapter] Cleansed legacy SSoT 5.1 tool log (empty result) at index ${i}`);
                        continue;
                    }
                    if (isArray) {
                        msg.content = [{ type: 'text', text: cleanStr }];
                    } else {
                        msg.content = cleanStr;
                    }
                    log(`[adapter] Cleansed legacy SSoT 5.1 tool log from history at index ${i}`);
                }

                const errIdx = cleanStr.indexOf('⚠️ [Gemini API Error]');
                if (errIdx !== -1) {
                    // Also remove the preceding newline if it exists
                    const sliceIdx = errIdx > 0 && cleanStr[errIdx - 1] === '\n' ? errIdx - 1 : errIdx;
                    cleanStr = cleanStr.substring(0, sliceIdx);
                    
                    if (cleanStr.trim() === '') {
                        // If the message is completely empty after removing the error, remove the whole message
                        messages.splice(i, 1);
                    } else {
                        // Otherwise, keep the cleaned text (which may contain ZWC metadata)
                        if (isArray) {
                            msg.content = [{ type: 'text', text: cleanStr }];
                        } else {
                            msg.content = cleanStr;
                        }
                    }
                    log(`[adapter] Cleansed Gemini API Error from history at index ${i}`);
                }
            }
        }

        const stream = body.stream !== false;
        const sessionKey = body._openclawSessionKey || body._sessionId || 'default';
        const workspaceDir = body._workspaceDir || process.cwd();

        let reqModel = body.model || 'auto-gemini-3';
        if (reqModel === 'auto' || reqModel === 'gemini') {
            reqModel = 'auto-gemini-3';
        }

        // Extract system prompt from the messages array
        const systemMsg = messages.find(m => m.role === 'system');
        const systemPrompt = systemMsg ? extractText(systemMsg.content) : '';

        // Extract image paths from the last user message
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const lastUserText = lastUserMsg ? extractText(lastUserMsg.content) : '';

        // [media attached: /path/to/file (mime/type) | url] フォーマットから全メディアパスを抽出
        // Gemini CLIはファイル拡張子を自動判別するため、画像以外（音声・動画・PDF等）も拾う
        const mediaPaths = [];
        const mediaAttachedPattern = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;
        
        // DEBUG: 生データをログに出力
        log(`[debug] lastUserText (first 500 chars): ${lastUserText.substring(0, 500)}`);
        
        let mMatch;
        while ((mMatch = mediaAttachedPattern.exec(lastUserText)) !== null) {
            const content = mMatch[1].trim();
            log(`[debug] media attached content found: "${content}"`);
            // "3 files" のようなサマリーはスキップ
            if (/^\d+\s+files?$/i.test(content)) continue;
            // パスを抽出: "| url" や "(mime)" より前の部分が絶対パス
            const pathPart = content.split(/\s*[|(]\s*/)[0].trim();
            log(`[debug] pathPart extracted: "${pathPart}"`);
            if (pathPart && (pathPart.startsWith('/') || pathPart.includes(':\\'))) {
                mediaPaths.push(pathPart);
            }
        }

        // --- WebUI / image_url オブジェクト形式のセカンダリスキャン ---
        // Telegram 経由は文字列マーカーだが、WebUI は OpenAI 互換のオブジェクト形式で送るため。
        if (Array.isArray(lastUserMsg?.content)) {
            for (const part of lastUserMsg.content) {
                if (part && part.type === 'image_url' && part.image_url?.url) {
                    const url = part.image_url.url;
                    // data:image/... (base64) は現時点ではスキップ（Gemini CLI はファイルパスが必要）
                    if (url.startsWith('data:')) {
                        const localPath = saveBase64Image(url);
                        if (localPath && !mediaPaths.includes(localPath)) {
                            log(`[debug] image_url data-URI decoded and added: "${localPath}"`);
                            mediaPaths.push(localPath);
                        } else if (!localPath) {
                            log(`[debug] Failed to decode data-URI, skipping.`);
                        }
                        continue;
                    }
                    // file:// 形式を絶対パスに変換
                    const filePath = url.startsWith('file://') ? url.slice('file://'.length) : url;
                    if (filePath.startsWith('/') || filePath.includes(':\\')) {
                        // 重複チェック
                        if (!mediaPaths.includes(filePath)) {
                            log(`[debug] image_url path added: "${filePath}"`);
                            mediaPaths.push(filePath);
                        }
                    } else {
                        log(`[debug] image_url not a local path (skipped): "${url.substring(0, 100)}"`);
                    }
                }
            }
        }
        log(`[debug] Final mediaPaths: ${JSON.stringify(mediaPaths)}`);

        // Separate history from the prompt
        const lastUserIdx = messages.findLastIndex ? messages.findLastIndex(m => m.role === 'user')
            : (() => { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') return i; } return -1; })();

        const historyMessages = lastUserIdx > 0 ? messages.slice(0, lastUserIdx) : [];
        const promptText = lastUserText.replace(/\[media attached[^\]]*\]/gi, '').trim();

        const requestId = randomId();

        // ---------------------------------------------------------------
        // Summarization intercept (SSoT guard)
        // ---------------------------------------------------------------
        // OpenClaw may ask the LLM to summarize conversation history.
        // Forwarding this to Gemini CLI would be wasteful and dangerous:
        //   - Gemini CLI manages its own context compaction (<state_snapshot>)
        //   - The summarized text would become the new "history", destroying
        //     the real toolCalls / execution records in Gemini's session JSON.
        // Instead, we return a canned summary so OpenClaw is satisfied,
        // while Gemini CLI's memory (the SSoT) remains untouched.
        if (isSummarizationRequest(systemPrompt, promptText)) {
            log(`[summarize] Summarization request detected — delegating to Gemini CLI (isolated session)`);
            const sumSystemMdPath = require('path').join(require('os').tmpdir(), `gemini-system-__summarize_${requestId}.md`);
            fs.writeFileSync(sumSystemMdPath, systemPrompt || '', 'utf-8');

            await runGeminiStreaming({
                prompt: promptText,
                messages: [],
                model: reqModel,
                sessionName: null,
                mediaPaths: [],
                systemMdPath: sumSystemMdPath,
                res,
                requestId,
                onSessionId: null,
                sessionKey: `__summarize_${requestId}`,
            });

            try { fs.rmSync(sumSystemMdPath); } catch (_) {}
            log(`[summarize] Summary delegation complete.`);
            return;
        }

        // Set up Gemini system MD (SSoT 6.3)
        const systemMdSetupStart = Date.now();
        const tempSystemMdPath = require('path').join(require('os').tmpdir(), `gemini-system-${requestId}.md`);
        fs.writeFileSync(tempSystemMdPath, systemPrompt || '# OpenClaw Gemini Gateway', 'utf-8');
        debug(`[perf] System MD setup took ${Date.now() - systemMdSetupStart}ms (Path: ${tempSystemMdPath})`);

        // Look up existing Gemini session ID for this OpenClaw session
        // SSoT: We NO LONGER overwrite Gemini's session with client history.
        // Gemini CLI's own session JSON is the single source of truth.
        const sessionMap = loadSessionMap();
        let geminiSessionId = sessionMap[sessionKey] || null;
        log(`Selected model: ${reqModel}`);

        if (stream) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            let abortHandle = null;

            // HTTP 切断検知 (Node.js)
            // ストリーミング中にクライアントが切断した場合（例: /stop）、
            // サーバー側がまだ書き込みを終了していなければ強制終了する。
            res.on('close', () => {
                // writableEnded が false であれば、正常終了(res.end呼び出し)ではなく異常切断
                if (!res.writableEnded) {
                    log('[server] Client disconnected unexpectedly during streaming.');
                    if (abortHandle) {
                        abortHandle.kill();
                    }
                }
                try { fs.rmSync(tempSystemMdPath); } catch (_) { }
            });

            debug(`[perf] Request processing before runGeminiStreaming took ${Date.now() - reqStart}ms`);
            abortHandle = await runGeminiStreaming({
                prompt: promptText,
                messages: historyMessages.concat(messages.slice(lastUserIdx)),
                model: reqModel,
                sessionName: geminiSessionId,
                mediaPaths,
                systemMdPath: tempSystemMdPath,
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
                        } catch (_) { }
                    }
                },
                end: () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        id: `chatcmpl-${requestId}`,
                        object: 'chat.completion',
                        choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
                    }));
                    try { fs.rmSync(tempSystemMdPath); } catch (_) { }
                },
                on: () => { },
            };
            runGeminiStreaming({
                prompt: promptText,
                messages: historyMessages.concat(messages.slice(lastUserIdx)),
                model: reqModel,
                sessionName: geminiSessionId,
                mediaPaths,
                systemMdPath: tempSystemMdPath,
                req,
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

// サーバー起動
server.listen(PORT, () => {
    log(`Gemini CLI adapter listening on port ${PORT}`);
});

server.on('error', err => {
    console.error('[adapter] Server error:', err.message);
    process.exit(1);
});
