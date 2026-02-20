#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

const heartbeatMatch = systemBlock.match(/Heartbeat prompt: (.*)/);
const heartbeatPrompt = heartbeatMatch ? heartbeatMatch[1].trim() : 'ping';

let heartbeatContent = '';
const heartbeatContextMatch = systemBlock.match(/## .*?HEARTBEAT\.md\n\n([\s\S]*?)(?=\n## |$)/);
if (heartbeatContextMatch) {
    heartbeatContent = heartbeatContextMatch[1].trim();
}

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
// 4. Build system prompt from template
// ---------------------------------------------------------------------------

const templatePath = path.join(__dirname, 'adapter-template.md');
let systemMdContent = '';
try {
    if (fs.existsSync(templatePath)) {
        const tmpl = fs.readFileSync(templatePath, 'utf-8');
        systemMdContent = tmpl
            .replace(/\{\{PROVIDED_SYSTEM_PROMPT\}\}/g, providedSystemPrompt
                ? `## OpenClaw Dynamic Context\n\n${providedSystemPrompt}\n` : '')
            .replace(/\{\{WORKSPACE\}\}/g, workspace)
            .replace(/\{\{HEARTBEAT_PROMPT\}\}/g, heartbeatPrompt)
            .replace(/\{\{HEARTBEAT_CONTENT\}\}/g, heartbeatContent || 'No HEARTBEAT.md found or it is empty.')
            .replace(/\{\{CURRENT_TIME\}\}/g, new Date().toLocaleString() + ' (Local)');
    } else {
        systemMdContent = `# OpenClaw Gemini Gateway\n\nWarning: adapter-template.md not found. Running with no system prompt.`;
    }
} catch (e) {
    returnError('Failed to load adapter-template.md', e);
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
    '-o', 'json',
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
 * Run Gemini CLI synchronously.
 * Returns { stdout, stderr, status } on success, or { error } on failure.
 */
function runGemini(args) {
    const result = spawnSync(commandToRun, args, {
        env,
        input: userMessage,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: GEMINI_TIMEOUT_MS,
    });

    if (result.error) {
        const msg = result.error.code === 'ETIMEDOUT'
            ? `Gemini CLI timed out after ${GEMINI_TIMEOUT_MS / 1000}s (no-output watchdog or network hang)`
            : `Gemini CLI failed to start: ${result.error.message}`;
        return { error: msg };
    }

    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        return {
            error: `Gemini CLI exited with code ${result.status}${stderr ? ': ' + stderr.substring(0, 500) : ''}`,
        };
    }

    return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ---------------------------------------------------------------------------
// 9. Execute (with automatic --resume fallback)
// ---------------------------------------------------------------------------

let runResult = runGemini(geminiArgs);

// If --resume failed, clear stale mapping and retry as a fresh session
if (runResult.error && geminiSessionId) {
    console.error(`[adapter] --resume failed (${runResult.error}). Clearing stale session and retrying...`);
    delete sessionMap[openclawSessionId];
    try { fs.writeFileSync(mapFilePath, JSON.stringify(sessionMap, null, 2), 'utf-8'); } catch (_) {}
    runResult = runGemini(baseGeminiArgs);
}

// Clean up temporary system prompt file
try { fs.rmSync(tempSystemMdPath); } catch (_) {}

// ---------------------------------------------------------------------------
// 10. Process output → return to OpenClaw
// ---------------------------------------------------------------------------

if (runResult.error) {
    // Always return something so OpenClaw doesn't hang silently
    process.stdout.write(`⚠️ Gemini Backend Error: ${runResult.error}`);
    process.exit(0);
}

const rawOutput = (runResult.stdout || '').trim();

if (!rawOutput) {
    process.stdout.write('⚠️ Gemini Backend: Gemini CLI returned no output.');
    process.exit(0);
}

// Try to parse as JSON (Gemini CLI -o json format)
const jsonStart = rawOutput.indexOf('{');
if (jsonStart < 0) {
    // Not JSON — return as-is (plain text mode)
    process.stdout.write(rawOutput);
    process.exit(0);
}

try {
    const outputData = JSON.parse(rawOutput.substring(jsonStart));

    // Extract response text
    const responseText = outputData.response || outputData.responseText;
    if (responseText) {
        process.stdout.write(responseText);
    } else {
        // Unexpected JSON shape — return raw so we can see what it is
        process.stdout.write(rawOutput);
    }

    // Persist new Gemini session ID for future --resume
    const newSessionId = outputData.session_id || outputData.sessionId;
    if (newSessionId && newSessionId !== geminiSessionId) {
        sessionMap[openclawSessionId] = newSessionId;
        try {
            fs.mkdirSync(path.dirname(mapFilePath), { recursive: true });
            fs.writeFileSync(mapFilePath, JSON.stringify(sessionMap, null, 2), 'utf-8');
        } catch (_) {}
    }
} catch (_) {
    // JSON parse failed — return raw output as text
    process.stdout.write(rawOutput);
}
