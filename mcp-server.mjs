#!/usr/bin/env node

/**
 * mcp-server.mjs
 * OpenClaw Dynamic MCP Server Adapter for Gemini CLI
 *
 * Runs as a stdio MCP Server.
 * Dynamically loads OpenClaw tools and exposes them to Gemini CLI via MCP.
 *
 * Usage:
 *   node mcp-server.mjs <sessionKey> [workspaceDir]
 *
 * Path resolution is fully portable using import.meta.url,
 * so this file can be placed anywhere relative to the openclaw repo root.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------- [0] Portable path setup ----------
// Resolve paths relative to this script, not the CWD.
// This makes the script work from any directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The openclaw repo root is one level above this `gemini-cli-claw/` directory.
const OPENCLAW_ROOT = path.resolve(__dirname, "..");
const OPENCLAW_DIST = path.join(OPENCLAW_ROOT, "dist", "index.js");

console.error(`[MCP Adapter] Script location: ${__dirname}`);
console.error(`[MCP Adapter] OpenClaw root: ${OPENCLAW_ROOT}`);

// ---------- [1] Dynamic Tool Loading from OpenClaw ----------
let openclawTools = [];

async function loadOpenClawTools(sessionKey, workspaceDir) {
    try {
        console.error(`[MCP Adapter] Loading OpenClaw tools for session: ${sessionKey}`);

        // Import the built OpenClaw bundle
        const openclaw = await import(OPENCLAW_DIST);
        const { createOpenClawCodingTools, loadConfig } = openclaw;

        // Load the OpenClaw configuration (reads ~/.openclaw/openclaw.json)
        // This is critical: without config, tools like `message`, `cron` etc.
        // can't find their webhook URLs, authentication tokens, etc.
        let config;
        try {
            config = loadConfig();
            console.error(`[MCP Adapter] OpenClaw config loaded successfully`);
        } catch (e) {
            console.error(`[MCP Adapter] Warning: could not load OpenClaw config: ${e.message}`);
            console.error(`[MCP Adapter] Tools requiring config (message, cron etc.) may not work`);
        }

        // Create the full tool array with proper session context and config
        const tools = createOpenClawCodingTools({
            sessionKey,                          // ties tool scopes to the correct session
            workspaceDir: workspaceDir || OPENCLAW_ROOT,
            config,                              // KEY FIX: pass full OpenClaw config
            senderIsOwner: true,                 // MCP adapter runs as owner
        });

        // Exclude tools that Gemini CLI already provides natively
        // (avoid conflicts with Gemini's own file/shell tools)
        const excludedTools = new Set(["read", "write", "edit", "exec", "process", "bash"]);
        openclawTools = tools.filter(t => !excludedTools.has(t.name));

        console.error(`[MCP Adapter] Loaded ${openclawTools.length} OpenClaw-specific tools:`);
        console.error(`  ${openclawTools.map(t => t.name).join(", ")}`);
    } catch (e) {
        console.error(`[MCP Adapter] FATAL: Failed to load OpenClaw tools:`, e);
        openclawTools = [];
    }
}

// ---------- [2] MCP Server Setup ----------
const server = new Server(
    {
        name: "openclaw-dynamic-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const activeRequests = new Map();

// Handle Cancellation
server.onnotification = (notification) => {
    if (notification.method === "notifications/cancelled") {
        const requestId = notification.params?.requestId;
        if (requestId && activeRequests.has(requestId)) {
            console.error(`[MCP Adapter] Received cancellation for request: ${requestId}`);
            const abortController = activeRequests.get(requestId);
            abortController.abort();
            activeRequests.delete(requestId);
        }
    }
};

// Handle "ListTools" — returns the schema of all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: openclawTools.map((tool) => ({
            name: tool.name,
            description: tool.description || "",
            inputSchema: tool.parameters ?? { type: "object", properties: {} },
        })),
    };
});

// Handle "CallTool" — dispatches to OpenClaw's native tool.execute()
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments || {};
    const progressToken = request.params._meta?.progressToken;
    const requestId = extra?.requestId || request.id; // Depending on SDK exact shape

    const targetTool = openclawTools.find(t => t.name === toolName);

    if (!targetTool) {
        return {
            content: [{
                type: "text",
                text: `Unknown tool: ${toolName}. Available: ${openclawTools.map(t => t.name).join(", ")}`,
                isError: true,
            }],
        };
    }

    const abortController = new AbortController();
    if (requestId) {
        activeRequests.set(requestId, abortController);
    }

    try {
        console.error(`[MCP Adapter] Executing tool: ${toolName} (progressToken: ${progressToken})`);

        const toolCallId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const result = await targetTool.execute(
            toolCallId,
            toolArgs,
            abortController.signal,
            (update) => {
                console.error(`[MCP Adapter] ${toolName} [update]:`, JSON.stringify(update).slice(0, 200));
                if (progressToken) {
                    server.notification({
                        method: "notifications/progress",
                        params: {
                            progressToken: progressToken,
                            progress: typeof update.progress === 'number' ? update.progress : 0,
                            total: 100,
                            data: update.message || JSON.stringify(update)
                        }
                    }).catch(e => console.error("[MCP Adapter] Failed to emit progress:", e));
                }
            }
        );

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
        console.error(`[MCP Adapter] Error executing ${toolName}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error executing ${toolName}: ${error?.message || String(error)}`,
                isError: true,
            }],
        };
    }
});

// ---------- [3] Startup ----------
async function run() {
    // CLI args: node mcp-server.mjs <sessionKey> [workspaceDir]
    const sessionKey = process.argv[2] || "mcp-default";
    const workspaceDir = process.argv[3] || undefined;

    await loadOpenClawTools(sessionKey, workspaceDir);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[MCP Adapter] Server ready (session: ${sessionKey})`);
}

run().catch((error) => {
    console.error("[MCP Adapter] Fatal error:", error);
    process.exit(1);
});
