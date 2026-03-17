#!/usr/bin/env node

/**
 * mcp-server.mjs
 * OpenClaw MCP Server Adapter for Gemini CLI
 *
 * Runs as a stdio MCP Server.
 * Dynamically locates the OpenClaw internal chunk that defines
 * `createOpenClawCodingTools` and loads it directly.
 * This avoids depending on the public API of dist/index.js (which does not
 * export createOpenClawCodingTools) while still working across builds.
 *
 * Gemini CLI natively provides: file read/write/edit, exec/bash, web search,
 * web fetch, browser control — so those tools are excluded here.
 *
 * Usage:
 *   node mcp-server.mjs <sessionKey> [workspaceDir]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

// ---------- [0] Portable path setup ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, "logs", "mcp.log");

function logToBoth(msg) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}`;
    console.error(formatted);
    try {
        if (!fs.existsSync(path.dirname(LOG_FILE))) {
            fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, formatted + "\n");
    } catch (_) { }
}

let OPENCLAW_ROOT;

// 1. 環境変数による完全指定 (Dockerなどでセットアップ時に固定)
if (process.env.OPENCLAW_PATH && fs.existsSync(path.join(process.env.OPENCLAW_PATH, "dist", "index.js"))) {
    OPENCLAW_ROOT = process.env.OPENCLAW_PATH;
}
// 2. ローカル開発環境の静的パス (__dirname/..)
else if (fs.existsSync(path.join(path.resolve(__dirname, ".."), "dist", "index.js"))) {
    OPENCLAW_ROOT = path.resolve(__dirname, "..");
}
// 3. 動的フォールバック: グローバルインストール先の探索
else {
    try {
        const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const globalOpenClawPath = path.join(npmRoot, "openclaw");
        if (fs.existsSync(path.join(globalOpenClawPath, "dist", "index.js"))) {
            OPENCLAW_ROOT = globalOpenClawPath;
        } else {
            // macOS / Linux の一般的なグローバル npm prefix の直下もチェック
            const fallbackPath = path.resolve('/usr/local/lib/node_modules/openclaw');
            if (fs.existsSync(path.join(fallbackPath, "dist", "index.js"))) {
                OPENCLAW_ROOT = fallbackPath;
            }
        }
    } catch (e) {
        logToBoth(`[MCP Adapter] Warning: Global path resolution failed: ${e.message}`);
    }
}

if (!OPENCLAW_ROOT) {
    logToBoth("[MCP Adapter] FATAL: Could not resolve OPENCLAW_ROOT path.");
    process.exit(1);
}

const OPENCLAW_DIST = path.join(OPENCLAW_ROOT, "dist");
const OPENCLAW_DIST_INDEX = path.join(OPENCLAW_DIST, "index.js");

logToBoth(`[MCP Adapter] Script location: ${__dirname}`);
logToBoth(`[MCP Adapter] OpenClaw root: ${OPENCLAW_ROOT}`);
function findCreateOpenClawToolsChunk(distDir) {
    let files;
    try {
        files = fs.readdirSync(distDir).filter(f =>
            f.endsWith(".js") &&
            // daemon-cli は巨大でスキップ
            !f.startsWith("daemon-cli")
        );
    } catch (e) {
        logToBoth(`[MCP Adapter] Cannot read dist dir: ${e.message}`);
        return null;
    }

    // "reply-*.js" はこの関数を含む可能性が高いので優先スキャン
    const prioritized = [
        ...files.filter(f => f.startsWith("reply-")),
        ...files.filter(f => !f.startsWith("reply-")),
    ];

    // エクスポート文の中の "createOpenClawTools as SHORT_ALIAS" を探す
    const EXPORT_PATTERN = /\bcreateOpenClawTools as (\w+)\b/;

    for (const file of prioritized) {
        const fullPath = path.join(distDir, file);
        try {
            const content = fs.readFileSync(fullPath, "utf8");
            const match = content.match(EXPORT_PATTERN);
            if (match) {
                logToBoth(`[MCP Adapter] Found createOpenClawTools in: ${file} (alias: "${match[1]}")`);
                return { path: fullPath, alias: match[1] };
            }
        } catch (_) {
            // skip unreadable files
        }
    }
    return null;
}

// ---------- [2] Dynamic Tool Loading ----------
let openclawTools = [];

// ------------------------------------------------------------------
// [重複回避] Gemini CLI 側ですでに提供されているツールのリスト
// このリストに含まれる名前のツールは、OpenClaw側のMCPツールから除外します。
// ------------------------------------------------------------------
const EXCLUDED_DUPLICATE_TOOLS = new Set([
    "read", "write", "edit", "exec", "bash", "process",
    "webSearch", "web_search", "webFetch", "web_fetch",
    "image", "canvas",
]);

async function loadOpenClawTools(sessionKey, workspaceDir) {
    try {
        logToBoth(`[MCP Adapter] Loading OpenClaw tools for session: ${sessionKey}`);

        // Step 1: loadConfig だけを公開APIから取得
        const indexMod = await import(OPENCLAW_DIST_INDEX);
        const { loadConfig } = indexMod;

        // Step 2: dist/ をスキャンして createOpenClawTools のチャンクとエイリアスを特定
        const found = findCreateOpenClawToolsChunk(OPENCLAW_DIST);
        if (!found) {
            // [将来のLLM/開発者へのメッセージ]
            // ここでエラーが出ている場合、OpenClaw本体（upstream）のビルドシステムやアーキテクチャが
            // 大幅に変更され、dist/ 内部に `createOpenClawTools` という文字列自体が存在しなくなっています。
            // これまでは、バンドル後のJSファイル（reply-*.js など）を直接テキストスキャンし、
            // 正規表現 /\bcreateOpenClawTools as (\w+)\b/ でエクスポート名（alias）を動的に見つけて
            // 強制的に import() するというハックで動かしていました。
            // もしこのハックが通じなくなった場合、OpenClaw側から提供される「公式のMCPサーバー機能」を利用するか、
            // `openclaw cron list --json` などのCLIコマンドを child_process で叩き、
            // このアダプター側で自前で Tool Schema と実行ロジック（CLIラッパー）を再実装することを推奨します。
            throw new Error(
                "[FATAL] dist/ 内で createOpenClawTools のエクスポートが見つかりません。\n" +
                "openclaw リポジトリをビルド(pnpm build)していないか、OpenClawの内部アーキテクチャが変わった可能性があります。\n" +
                "ソースコード内の【将来のLLM/開発者へのメッセージ】コメントを参照してください。"
            );
        }

        // Step 3: チャンクを動的インポートしてエイリアス経由で関数を取得
        const chunkMod = await import(found.path);
        const createOpenClawTools = chunkMod[found.alias];

        if (typeof createOpenClawTools !== "function") {
            // [将来のLLM/開発者へのメッセージ]
            // テキストスキャンでのエイリアス抽出には成功しましたが、実際の import(module) 結果に
            // その名前の関数が存在しませんでした。ESM/CommonJSの仕様変更や、Rollup/Viteなどの
            // バンドラ側の出力形式（export objectの構造）が変わった可能性があります。
            throw new Error(
                `[FATAL] エイリアス "${found.alias}" が関数ではありません（type: ${typeof createOpenClawTools}）。\n` +
                "ビルド構造が変わった可能性があります。ソースコードの【将来のLLM/開発者へのメッセージ】を参照してください。"
            );
        }

        // Step 4: OpenClaw 設定を読み込む
        let config;
        try {
            config = loadConfig();
            logToBoth(`[MCP Adapter] OpenClaw config loaded OK`);
            // デバッグログ追加：設定ファイルの特定
            if (config?._meta?.configPath) {
                logToBoth(`[MCP Adapter] Config Path: ${config._meta.configPath}`);
            }
            logToBoth(`[MCP Adapter] Cron Storage: ${config?.cron?.storage || "default (~/.openclaw/cron/jobs.json)"}`);
        } catch (e) {
            logToBoth(`[MCP Adapter] Warning: OpenClaw config not loaded: ${e.message}`);
        }

        // Step 5: ツールを生成
        const finalWorkspace = workspaceDir || OPENCLAW_ROOT;
        logToBoth(`[MCP Adapter] Final Workspace: ${finalWorkspace}`);

        const allTools = createOpenClawTools({
            agentSessionKey: sessionKey,
            workspaceDir: finalWorkspace,
            config,
            senderIsOwner: true,
        });

        // Step 6: Gemini CLI ネイティブと重複するツールを除外
        openclawTools = allTools.filter(t => !EXCLUDED_DUPLICATE_TOOLS.has(t.name));

        logToBoth(`[MCP Adapter] Loaded ${openclawTools.length} OpenClaw tools:`);
        logToBoth(`  ${openclawTools.map(t => t.name).join(", ")}`);
    } catch (e) {
        logToBoth(`[MCP Adapter] FATAL: Failed to load OpenClaw tools:`, e);
        openclawTools = [];
    }
}


// ---------- [3] MCP Server Setup ----------
const server = new Server(
    {
        name: "openclaw-dynamic-mcp",
        version: "2.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const activeRequests = new Map();

// Handle cancellation notifications
server.onnotification = (notification) => {
    if (notification.method === "notifications/cancelled") {
        const requestId = notification.params?.requestId;
        if (requestId && activeRequests.has(requestId)) {
            logToBoth(`[MCP Adapter] Cancelling request: ${requestId}`);
            activeRequests.get(requestId).abort();
            activeRequests.delete(requestId);
        }
    }
};

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: openclawTools.map((tool) => ({
            name: tool.name,
            description: tool.description || "",
            inputSchema: tool.parameters ?? { type: "object", properties: {} },
        })),
    };
});

// Dispatch tool calls
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments || {};
    const progressToken = request.params._meta?.progressToken;
    const requestId = extra?.requestId || request.id;

    const targetTool = openclawTools.find(t => t.name === toolName);

    if (!targetTool) {
        const available = openclawTools.map(t => t.name).join(", ") || "(none loaded)";
        return {
            content: [{
                type: "text",
                text: `Unknown tool: "${toolName}". Available OpenClaw tools: ${available}`,
                isError: true,
            }],
        };
    }

    const abortController = new AbortController();
    if (requestId) activeRequests.set(requestId, abortController);

    try {
        logToBoth(`[MCP Adapter] Executing: ${toolName} with args: ${JSON.stringify(toolArgs)}`);

        const toolCallId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const result = await targetTool.execute(
            toolCallId,
            toolArgs,
            abortController.signal,
            (update) => {
                logToBoth(`[MCP Adapter] ${toolName} update:`, JSON.stringify(update).slice(0, 200));
            }
        );

        logToBoth(`[MCP Adapter] ${toolName} execution result: ${JSON.stringify(result).slice(0, 500)}`);

        if (requestId) activeRequests.delete(requestId);

        let responseText;
        if (result == null) {
            responseText = "(no output)";
        } else if (typeof result === "string") {
            responseText = result;
        } else if (result.text != null) {
            responseText = result.text;
        } else {
            responseText = JSON.stringify(result, null, 2);
        }

        return {
            content: [{
                type: "text",
                text: responseText,
            }],
        };
    } catch (error) {
        if (requestId) activeRequests.delete(requestId);
        logToBoth(`[MCP Adapter] Error executing ${toolName}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error executing ${toolName}: ${error?.message || String(error)}`,
                isError: true,
            }],
        };
    }
});

// ---------- [4] Startup ----------
async function run() {
    const sessionKey = process.argv[2] || process.env.OPENCLAW_SESSION_KEY || "mcp-default";
    const workspaceDir = process.argv[3] || undefined;

    await loadOpenClawTools(sessionKey, workspaceDir);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logToBoth(`[MCP Adapter] Server ready (session: ${sessionKey}, tools: ${openclawTools.length})`);
}

run().catch((error) => {
    logToBoth("[MCP Adapter] Fatal error:", error);
    process.exit(1);
});
