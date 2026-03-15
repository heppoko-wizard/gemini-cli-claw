'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, randomId, sseWrite } = require('./utils');

// ---------------------------------------------------------------------------
// Zero-Width Character Steganography (SSoT 3.1)
// ---------------------------------------------------------------------------
const ZWC_START = '\u200B\u200C\u200B\u200C\u200B\u200D';
const ZWC_END = '\u200C\u200B\u200C\u200B\u200C';

function encodeZwc(text) {
    const encoded = Array.from(Buffer.from(text, 'utf8')).map(byte => {
        return byte.toString(2).padStart(8, '0').split('').map(bit => bit === '1' ? '\u200B' : '\u200C').join('');
    }).join('\u200D');
    return ZWC_START + encoded + ZWC_END;
}

function decodeZwc(zwcStr) {
    try {
        let coreStr = zwcStr.replace(ZWC_START, '').replace(ZWC_END, '');
        // 強制改行やマークダウンのワードラップによるノイズ(改行、スペース等)を完全に除去する
        coreStr = coreStr.replace(/[^\u200B\u200C\u200D]/g, '');
        
        const bytes = coreStr.split('\u200D').map(zwcByte => {
            const bits = zwcByte.split('').map(char => char === '\u200B' ? '1' : '0').join('');
            return parseInt(bits, 2);
        });
        return Buffer.from(bytes).toString('utf8');
    } catch (e) {
        return null;
    }
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
async function runGeminiStreaming({ prompt, messages, model, sessionName, mediaPaths, env, res, requestId, onSessionId, sessionKey, skipZwcProcessing = false }) {
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
        if (!skipZwcProcessing && messages && messages.length > 0) {
            const geminiMessages = [];
            const timestamp = new Date().toISOString();

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
                    // --- SSoT 3.1: ゼロ幅文字メタデータの抽出と再構築 (SSoT 4.0 堅牢化版) ---
                    const toolCalls = [];
                    const timestamp = new Date().toISOString();

                    // 壊れた ZWC (切り詰められたものなど) も逃さず捕捉するために、
                    // 開始コードを基準にテキストをスキャンする
                    let searchIdx = 0;
                    while (true) {
                        const startIdx = text.indexOf(ZWC_START, searchIdx);
                        if (startIdx === -1) break;

                        const afterStart = text.substring(startIdx + ZWC_START.length);
                        const endIdxRelative = afterStart.indexOf(ZWC_END);
                        
                        let zwcBlock;
                        let isTruncated = false;

                        if (endIdxRelative !== -1) {
                            // 正常な終了コードが見つかった
                            zwcBlock = text.substring(startIdx, startIdx + ZWC_START.length + endIdxRelative + ZWC_END.length);
                            searchIdx = startIdx + zwcBlock.length;
                        } else {
                            // 終了コードが見つからない（途中で切り詰められた）
                            // 次の開始コードが現れるか、テキストの末尾までを一つのブロックとして扱う
                            const nextStartRelative = afterStart.indexOf(ZWC_START);
                            const captureLen = nextStartRelative !== -1 ? nextStartRelative : afterStart.length;
                            zwcBlock = text.substring(startIdx, startIdx + ZWC_START.length + captureLen);
                            isTruncated = true;
                            searchIdx = startIdx + zwcBlock.length;
                        }

                        try {
                            const decodedJson = decodeZwc(zwcBlock);
                            if (!decodedJson) throw new Error("Failed to decode ZWC string");
                            const meta = JSON.parse(decodedJson);

                            if (meta.type === 'tool_use_pointer' || meta.type === 'tool_use') {
                                // SSoT 4.0: ローカルファイルから tool_use の実データをリハイドレート
                                let actualUse = meta;
                                if (meta.type === 'tool_use_pointer') {
                                    const contextPath = path.join(__dir, 'logs', 'contexts', meta.sessionKey || sessionKey || 'default', `tool_use_${meta.tool_id}.json`);
                                    try {
                                        if (fs.existsSync(contextPath)) {
                                            actualUse = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
                                        } else {
                                            log(`[adapter] ⚠️ Context file not found for tool_use ${meta.tool_id}, using pointer data.`);
                                        }
                                    } catch (e) {
                                        log(`[adapter] ⚠️ Failed to rehydrate context for tool_use ${meta.tool_id}: ${e.message}`);
                                    }
                                }

                                toolCalls.push({
                                    id: actualUse.tool_id,
                                    name: actualUse.tool_name,
                                    args: actualUse.parameters || {},
                                    status: 'success',
                                    timestamp: timestamp
                                });
                            } else if (meta.type === 'tool_result_pointer' || meta.type === 'tool_result') {
                                // SSoT 4.0: ローカルファイルから実データをリハイドレート
                                let actualResult = meta;
                                if (meta.type === 'tool_result_pointer') {
                                    const contextPath = path.join(__dir, 'logs', 'contexts', meta.sessionKey || sessionKey || 'default', `tool_${meta.tool_id}.json`);
                                    try {
                                        if (fs.existsSync(contextPath)) {
                                            actualResult = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
                                        } else {
                                            log(`[adapter] ⚠️ Context file not found for ${meta.tool_id}, using pointer data.`);
                                        }
                                    } catch (e) {
                                        log(`[adapter] ⚠️ Failed to rehydrate context for ${meta.tool_id}: ${e.message}`);
                                    }
                                }

                                const targetCall = toolCalls.find(tc => tc.id === actualResult.tool_id);
                                if (targetCall) {
                                    targetCall.result = [{
                                        functionResponse: {
                                            name: targetCall.name,
                                            response: {
                                                output: actualResult.output || (actualResult.error ? JSON.stringify(actualResult.error) : 'success')
                                            }
                                        }
                                    }];
                                }
                            }
                        } catch (e) {
                            // 壊れたメタデータを「完全転写」して専用ログに記録
                            const errLogPath = path.join(__dir, 'logs', 'zwc_errors.log');
                            let transcript = `[${new Date().toISOString()}] ${isTruncated ? 'TRUNCATED' : 'INVALID'} ZWC ERROR: ${e.message}\n`;
                            const decodedAttempt = decodeZwc(zwcBlock) || "(decode failed)";
                            transcript += `Decoded Attempt: ${decodedAttempt}\n`;
                            transcript += `Raw ZWC Data (Length ${zwcBlock.length}): ${zwcBlock}\n\n`;
                            
                            try { fs.appendFileSync(errLogPath, transcript); } catch (_) {}
                            log(`[adapter] ⚠️ Captured and transcribed broken ZWC to logs/zwc_errors.log`);
                        }
                    }

                    // --- SSoT 4.2: プレーンテキスト・ポインタのスキャン (ZWC 廃止後の新形式) ---
                    // [id:xxx] => tool_use, [res:xxx] => tool_result として処理する
                    const idPattern = /\[id:([^\]]+)\]/g;
                    const resPattern = /\[res:([^\]]+)\]/g;
                    let ptMatch;
                    while ((ptMatch = idPattern.exec(text)) !== null) {
                        const toolId = ptMatch[1];
                        if (!toolCalls.find(tc => tc.id === toolId)) {
                            const contextPath = path.join(__dir, 'logs', 'contexts', sessionKey || 'default', `tool_use_${toolId}.json`);
                            try {
                                if (fs.existsSync(contextPath)) {
                                    const actualUse = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
                                    toolCalls.push({
                                        id: actualUse.tool_id,
                                        name: actualUse.tool_name,
                                        args: actualUse.parameters || {},
                                        status: 'success',
                                        timestamp: timestamp
                                    });
                                }
                            } catch (e) {
                                log(`[adapter] ⚠️ [SSoT 4.2] Failed to rehydrate tool_use ${toolId}: ${e.message}`);
                            }
                        }
                    }
                    while ((ptMatch = resPattern.exec(text)) !== null) {
                        const toolId = ptMatch[1];
                        const contextPath = path.join(__dir, 'logs', 'contexts', sessionKey || 'default', `tool_${toolId}.json`);
                        try {
                            if (fs.existsSync(contextPath)) {
                                const actualResult = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
                                const targetCall = toolCalls.find(tc => tc.id === toolId);
                                if (targetCall && !targetCall.result) {
                                    targetCall.result = [{
                                        functionResponse: {
                                            name: targetCall.name,
                                            response: {
                                                output: actualResult.output || (actualResult.error ? JSON.stringify(actualResult.error) : 'success')
                                            }
                                        }
                                    }];
                                }
                            }
                        } catch (e) {
                            log(`[adapter] ⚠️ [SSoT 4.2] Failed to rehydrate tool_result ${toolId}: ${e.message}`);
                        }
                    }

                    // 抽出が終わったら、ゴミテキストを完全に消去する。
                    // 壊れた ZWC の残骸も含め、全てのゼロ幅文字(\u200B-\u200D)を物理的に除去する。
                    let cleanText = text.replace(/[\u200B\u200C\u200D]/g, '');
                    // SSoT 4.2: アダプターが付与した表示行（全角スペース付き）を完全削除
                    // 行頭の改行や、インデントとして使用している全角スペースを含めてマッチさせる
                    cleanText = cleanText.replace(/\n*[ \t　]*⚙️ Using tool \[[^\]]*\](?:\s*\[id:[^\]]*\])? \.\.\.\n*/g, '');
                    cleanText = cleanText.replace(/\n?[ \t　]*[✅❌] Tool (finished|failed)[^\n]*/g, '');
                    cleanText = cleanText.trim();

                    // Gemini用メッセージオブジェクトの構築
                    const geminiMsg = {
                        type: 'gemini',
                        content: [{ text: cleanText }]
                    };

                    // 復元した toolCalls があればアタッチする
                    if (toolCalls.length > 0) {
                        geminiMsg.toolCalls = toolCalls;

                        // 万が一クリーンなアシスタントのテキストが空になってしまった場合は、
                        // スキーマバリデーションエラーを防ぐために空文字をセットするか、
                        // もしくは純粋なツール実行のみのターンとして振る舞う
                        if (!cleanText) {
                            geminiMsg.content = [{ text: '' }];
                        }
                    }

                    geminiMessages.push(geminiMsg);
                } else if (msg.role === 'tool' || msg.role === 'toolResult') {
                    // OpenClaw自身がツールを実行して結果を返してきた場合 (旧仕様用・念のため残す)
                    // (SSoT3.0では基本的にここは通らない)
                    continue; // SSoT3.0ではインラインで処理済みのためスキップ
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
                        if (json.type === 'result' && json.status === 'error') {
                            const errMsg = json.error ? json.error.message : JSON.stringify(json);
                            sseWrite(res, {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: 'gemini',
                                choices: [{
                                    index: 0,
                                    delta: { content: `\n⚠️ [Gemini API Error] ${errMsg}` },
                                    finish_reason: null
                                }]
                            });
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

                                // SSoT 4.2: 直前がツール出力だった場合、地の文との間に改行を挟む
                                let finalContent = json.content;
                                if (lastWasTool && json.content.trim()) {
                                    finalContent = '\n' + json.content;
                                    lastWasTool = false;
                                }

                                sseWrite(res, {
                                    id: responseId,
                                    object: 'chat.completion.chunk',
                                    created: Math.floor(Date.now() / 1000),
                                    model: 'gemini',
                                    choices: [{
                                        index: 0,
                                        delta: { content: finalContent },
                                        finish_reason: null
                                    }]
                                });
                            }
                        }
                        break;

                    case 'tool_use': {
                        // SSoT 4.0: サーバーサイド・コンテキスト・リハイドレーション (tool_use用)
                        // 巨大な引数(パラメータ)を持つツール使用通知をセッションごとにローカル保存し、OpenClawには軽量なポインタ(ZWC)のみを返す
                        const contextStoreDir = path.join(__dir, 'logs', 'contexts', sessionKey || 'default');
                        if (!fs.existsSync(contextStoreDir)) {
                            fs.mkdirSync(contextStoreDir, { recursive: true });
                        }

                        // 実データをローカルに保存 (tool_use_id をファイル名にする)
                        const contextPath = path.join(contextStoreDir, `tool_use_${json.tool_id}.json`);
                        try {
                            fs.writeFileSync(contextPath, JSON.stringify(json), 'utf-8');
                        } catch (e) {
                            log(`[adapter] Failed to save context for tool_use ${json.tool_id}: ${e.message}`);
                        }

                        // SSoT 4.2: プレーンテキスト・ポインタ方式 (ZWC 廃止)
                        // 全角スペース (　) のみでインデントを構成。記号なしでもレンダラーによるトリミングを回避可能。
                        lastWasTool = true;
                        sseWrite(res, {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: 'gemini',
                            choices: [{
                                index: 0,
                                delta: { content: `\n　　　⚙️ Using tool [${json.tool_name}] [id:${json.tool_id}] ...` },
                                finish_reason: null
                            }]
                        });
                        break;
                    }

                    case 'tool_result': {
                        // SSoT 4.0: サーバーサイド・コンテキスト・リハイドレーション
                        // 巨大なツール実行結果をセッションごとにローカル保存し、OpenClawには軽量なポインタ(ZWC)のみを返す
                        const isSuccess = json.status === 'success' && !json.error;
                        const statusIcon = isSuccess ? '✅' : '❌';
                        let toolMsg;
                        if (isSuccess) {
                            toolMsg = `${statusIcon} Tool finished.`;
                        } else if (json.error) {
                            toolMsg = `${statusIcon} Tool failed. Error: ${json.error}`;
                        } else if (json.exitCode !== undefined && json.exitCode !== 0) {
                            toolMsg = `${statusIcon} Tool failed. (Exit Code: ${json.exitCode})`;
                        } else {
                            toolMsg = `${statusIcon} Tool finished with unknown status.`;
                        }

                        // セッション専用のコンテキストストレージを準備
                        const contextStoreDir = path.join(__dir, 'logs', 'contexts', sessionKey || 'default');
                        if (!fs.existsSync(contextStoreDir)) {
                            fs.mkdirSync(contextStoreDir, { recursive: true });
                        }

                        // 実データをローカルに保存 (tool_id をファイル名にする)
                        const contextPath = path.join(contextStoreDir, `tool_${json.tool_id}.json`);
                        try {
                            fs.writeFileSync(contextPath, JSON.stringify(json), 'utf-8');
                        } catch (e) {
                            log(`[adapter] Failed to save context for ${json.tool_id}: ${e.message}`);
                        }

                        // SSoT 4.2: プレーンテキスト・ポインタ方式 (ZWC 廃止)
                        // 全角スペースのみのインデント。
                        lastWasTool = true;
                        sseWrite(res, {
                            id: responseId,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: 'gemini',
                            choices: [{
                                index: 0,
                                delta: { content: `\n　　　${toolMsg} [res:${json.tool_id}]` },
                                finish_reason: null
                            }]
                        });
                        break;
                    }

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
