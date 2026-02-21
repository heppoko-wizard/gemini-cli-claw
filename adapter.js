#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return an error message to OpenClaw via stdout and exit.
 * This guarantees OpenClaw always gets a response, never a silent hang.
 */
function returnError(msg, err) {
    const detail = err instanceof Error ? err.message : (err ? String(err) : '');
    const text = detail ? `⚠️ Gemini Backend Error: ${msg}: ${detail}` : `⚠️ Gemini Backend Error: ${msg}`;
    try { process.stdout.write(text); } catch (_) {}
    process.exit(0); // exit 0 so OpenClaw treats the text output as a response
}

// ---------------------------------------------------------------------------
// 1. Read stdin
// ---------------------------------------------------------------------------

let stdin = '';
try {
    stdin = fs.readFileSync(0, 'utf-8');
} catch (e) {
    returnError('Failed to read stdin', e);
}

// === TEMP DEBUG: stdinの内容確認 ===
const _dbgPath = path.join(__dirname, 'adapter-debug.log');
try {
    fs.appendFileSync(_dbgPath, `[${new Date().toISOString()}] stdin(${stdin.length}):\n${stdin.substring(0, 600)}\n---\n`);
} catch(_) {}
// === END TEMP DEBUG ===

// ---------------------------------------------------------------------------
// 2. Parse OpenClaw payload
//    OpenClaw wraps its system prompt in <system>...</system>
// ---------------------------------------------------------------------------

const systemRegex = /<system>\n([\s\S]*?)\n<\/system>/;
const systemMatch = stdin.match(systemRegex);

let systemBlock = '';
let userMessage = stdin;

if (systemMatch) {
    systemBlock = systemMatch[1];
    userMessage = stdin.replace(systemMatch[0], '').trim();
}

// Extract image paths from user message: [media attached: path] or [Image: source: path]
const mediaPaths = [];
const imageExts = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i;

// Match [media attached N/M: path (type) | url] or [media attached: path]
const mediaAttachedPattern = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;
let match;
while ((match = mediaAttachedPattern.exec(userMessage)) !== null) {
    const content = match[1];
    if (/^\d+\s+files?$/i.test(content.trim())) continue;
    
    const pathMatch = content.match(/^\s*(.+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif))\s*(?:\(|$|\|)/i);
    if (pathMatch && pathMatch[1]) {
        mediaPaths.push(pathMatch[1].trim());
    }
}

// Match [Image: source: /path/...]
const messageImagePattern = /\[Image:\s*source:\s*([^\]]+\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif))\]/gi;
while ((match = messageImagePattern.exec(userMessage)) !== null) {
    if (match[1]) {
        mediaPaths.push(match[1].trim());
    }
}

// Optionally, remove the text references to avoid confusing the CLI or keeping them as text,
// but for now we leave them as Gemini might use them for context, 
// or we can remove them if they cause issues. We'll remove them to be clean.
userMessage = userMessage.replace(mediaAttachedPattern, '').replace(messageImagePattern, '').trim();

const workspaceMatch = systemBlock.match(/Your working directory is: (.*)/);
const workspace = workspaceMatch ? workspaceMatch[1].trim() : process.cwd();

// ---------------------------------------------------------------------------
// 3. Parse command line arguments
// ---------------------------------------------------------------------------

let openclawSessionId = 'default';
let providedSystemPrompt = '';
let allowedSkillsPathsStr = '';

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--session-id' && i + 1 < process.argv.length) {
        openclawSessionId = process.argv[++i];
    } else if (process.argv[i] === '--system' && i + 1 < process.argv.length) {
        providedSystemPrompt = process.argv[++i];
    } else if (process.argv[i] === '--allowed-skills' && i + 1 < process.argv.length) {
        allowedSkillsPathsStr = process.argv[++i];
    }
}

// ---------------------------------------------------------------------------
// 4. Build system prompt
// ---------------------------------------------------------------------------

// OpenClaw already provides a fully formed system prompt inside <system>...</system>.
// We use it directly as the Gemini CLI system prompt.
let systemMdContent = systemBlock || '';

if (!systemMdContent) {
    if (providedSystemPrompt) {
        systemMdContent = `## OpenClaw Dynamic Context\n\n${providedSystemPrompt}\n`;
    } else {
        systemMdContent = `# OpenClaw Gemini Gateway\n\nRunning with no system prompt.`;
    }
}

// ---------------------------------------------------------------------------
// 5. Write temporary system-prompt file
// ---------------------------------------------------------------------------

const tempSystemMdPath = path.join(
    os.tmpdir(),
    `gemini-system-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.md`
);
try {
    fs.writeFileSync(tempSystemMdPath, systemMdContent, 'utf-8');
} catch (e) {
    returnError('Failed to write temporary system prompt file', e);
}

// ---------------------------------------------------------------------------
// 6. Set up isolated GEMINI_CLI_HOME per session
// ---------------------------------------------------------------------------

const homeBaseDir = path.join(os.homedir(), '.openclaw', 'gemini-sessions');
const tempHomeDir = path.join(homeBaseDir, openclawSessionId);
const tempGeminiDir = path.join(tempHomeDir, '.gemini');

try {
    fs.mkdirSync(tempGeminiDir, { recursive: true });
} catch (e) {
    returnError(`Failed to create session directory: ${tempGeminiDir}`, e);
}

// Merge real settings.json with our MCP server injection
let userSettings = {};
const realGeminiDir = path.join(os.homedir(), '.gemini');
const realSettingsPath = path.join(realGeminiDir, 'settings.json');
try {
    if (fs.existsSync(realSettingsPath)) {
        userSettings = JSON.parse(fs.readFileSync(realSettingsPath, 'utf-8'));
    }
} catch (_) {
    // Non-fatal: proceed with empty settings
}

userSettings.mcpServers = userSettings.mcpServers || {};
userSettings.mcpServers['openclaw-tools'] = {
    command: 'node',
    args: [path.join(__dirname, 'mcp-server.mjs'), openclawSessionId, workspace],
};

try {
    fs.writeFileSync(
        path.join(tempGeminiDir, 'settings.json'),
        JSON.stringify(userSettings, null, 2),
        'utf-8'
    );
} catch (e) {
    returnError('Failed to write Gemini settings.json', e);
}

// Symlink auth/config files from real ~/.gemini into the isolated home
const filesToLink = ['oauth_creds.json', 'google_accounts.json', 'installation_id'];
for (const file of filesToLink) {
    const realFile = path.join(realGeminiDir, file);
    if (!fs.existsSync(realFile)) continue;
        try {
            // Windowsでの管理者権限エラー(EPERM)を回避するため、ファイルはシンボリックリンクではなくハードコピーする
            fs.copyFileSync(realFile, path.join(tempGeminiDir, file));
        } catch (e) {
            console.error(`[adapter] Warning: failed to copy ${file}: ${e.message}`);
        }
}

// Symlink allowed skills directories
if (allowedSkillsPathsStr) {
    const tempSkillsDir = path.join(tempGeminiDir, 'skills');
    try {
        fs.mkdirSync(tempSkillsDir, { recursive: true });
        for (const skillPath of allowedSkillsPathsStr.split(',').map(p => p.trim()).filter(Boolean)) {
            if (!fs.existsSync(skillPath)) continue;
            const linkTarget = path.join(tempSkillsDir, path.basename(skillPath));
            try {
                // 'junction' を使用することで、Windows（開発者モード非依存）でも管理者権限なしにディレクトリリンクを作成可能
                fs.symlinkSync(skillPath, linkTarget, 'junction');
            } catch (e) {
                if (e.code !== 'EEXIST') {
                    console.error(`[adapter] Warning: failed to symlink skill ${skillPath}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        // Non-fatal: skills may not be available but core functionality continues
        console.error(`[adapter] Warning: skill setup failed: ${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// 7. Session ID mapping  (OpenClaw sessionId <-> Gemini CLI sessionId)
// ---------------------------------------------------------------------------

const mapFilePath = path.join(os.homedir(), '.gemini', 'openclaw-session-map.json');
let sessionMap = {};
try {
    if (fs.existsSync(mapFilePath)) {
        sessionMap = JSON.parse(fs.readFileSync(mapFilePath, 'utf-8'));
    }
} catch (_) { /* Ignore: start with empty map */ }

const geminiSessionId = sessionMap[openclawSessionId];

// ---------------------------------------------------------------------------
// 8. Prepare Gemini CLI invocation
// ---------------------------------------------------------------------------

const geminiBinPath = path.join(__dirname, 'node_modules', '.bin', 'gemini');
const commandToRun = fs.existsSync(geminiBinPath) ? geminiBinPath : 'gemini';

const GEMINI_TIMEOUT_MS = 120_000; // 2 minutes

const baseGeminiArgs = [
    '--yolo',
    '-p', '',
    '-o', 'stream-json',
    '--allowed-mcp-server-names', 'openclaw-tools',
];

for (const mediaPath of mediaPaths) {
    baseGeminiArgs.push(`@${mediaPath}`);
}

const geminiArgs = geminiSessionId
    ? ['--resume', geminiSessionId, ...baseGeminiArgs]
    : [...baseGeminiArgs];

const env = {
    ...process.env,
    GEMINI_SYSTEM_MD: tempSystemMdPath,
    GEMINI_CLI_HOME: tempHomeDir,
};

/**
 * Run Gemini CLI using async streams to prevent timeouts and provide real-time feedback.
 */
function runGeminiAsync(args, sessionId) {
    const geminiProcess = spawn(commandToRun, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    // Write the prompt to stdin and close it to signal EOF
    if (userMessage) {
        geminiProcess.stdin.write(userMessage);
    }
    geminiProcess.stdin.end();

    let currentSessionId = sessionId;
    let buffer = '';

    geminiProcess.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const line = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);
            boundary = buffer.indexOf('\n');

            if (!line) continue;

            try {
                const json = JSON.parse(line);
                
                switch (json.type) {
                    case 'init':
                        if (json.session_id) currentSessionId = json.session_id;
                        break;
                    
                    case 'stream':
                    case 'message':
                        // Only output assistant's text deltas (or raw stream)
                        if ((json.type === 'stream' || (json.role === 'assistant' && json.delta)) && json.content) {
                            process.stdout.write(json.content);
                        }
                        break;
                        
                    case 'tool_use':
                        // Provide UX feedback to the OpenClaw user that a tool is running
                        const toolName = json.tool_name || json.name || 'unknown';
                        process.stdout.write(`\n\n🔧 [Gemini Runner: Executing ${toolName}...]\n`);
                        break;
                        
                    case 'result':
                        if (json.session_id) currentSessionId = json.session_id;
                        break;
                        
                    case 'error':
                        process.stdout.write(`\n⚠️ Gemini Backend Error: ${json.message || JSON.stringify(json)}\n`);
                        break;
                        
                    case 'raw':
                        if (json.content) process.stdout.write(json.content);
                        break;
                }
            } catch (e) {
                // Not JSON? Might be a raw warning or error from the CLI tool itself
                process.stdout.write(line + '\n');
            }
        }
    });

    let stderrBuffer = '';
    geminiProcess.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf-8');
    });

    geminiProcess.on('close', (code) => {
        // Retry logic: If this was a --resume request and it failed, clear cache and retry fresh
        if (code !== 0 && sessionId) {
            console.error(`[adapter] --resume failed (code ${code}). Clearing stale session and retrying...`);
            delete sessionMap[openclawSessionId];
            try { fs.writeFileSync(mapFilePath, JSON.stringify(sessionMap, null, 2), 'utf-8'); } catch (_) {}
            
            // Clean up temporary system prompt file for the retry
            try { fs.rmSync(tempSystemMdPath); } catch (_) {}
            
            // Re-run fresh (Warning: this might leave a dangling temp file if retry process exits abruptly, but acceptable for this edge case)
            const freshArgs = [...baseGeminiArgs];
            for (const mediaPath of mediaPaths) { freshArgs.push(`@${mediaPath}`); }
            
            return runGeminiAsync(freshArgs, null);
        }

        // Save the latest valid session ID for the next run
        if (currentSessionId && currentSessionId !== geminiSessionId) {
            sessionMap[openclawSessionId] = currentSessionId;
            try {
                fs.mkdirSync(path.dirname(mapFilePath), { recursive: true });
                fs.writeFileSync(mapFilePath, JSON.stringify(sessionMap, null, 2), 'utf-8');
            } catch (_) {}
        }
        
        // Clean up temporary system prompt file
        try { fs.rmSync(tempSystemMdPath); } catch (_) {}
        
        // If there was stderr output and non-zero exit, display it
        if (code !== 0 && stderrBuffer.trim()) {
            process.stdout.write(`\n⚠️ Gemini CLI exited with code ${code}: ${stderrBuffer.trim().substring(0, 500)}`);
        }
        
        process.exit(code);
    });

    geminiProcess.on('error', (err) => {
        process.stdout.write(`⚠️ Gemini CLI failed to start: ${err.message}`);
        try { fs.rmSync(tempSystemMdPath); } catch (_) {}
        process.exit(1);
    });
}

// ---------------------------------------------------------------------------
// 9. Execute Async Stream
// ---------------------------------------------------------------------------
runGeminiAsync(geminiArgs, geminiSessionId);
