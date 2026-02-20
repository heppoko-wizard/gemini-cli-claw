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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments || {};

    const targetTool = openclawTools.find(t => t.name === toolName);

    if (!targetTool) {
        // Return a structured error instead of throwing, to avoid crashing the server
        return {
            content: [{
                type: "text",
                text: `Unknown tool: ${toolName}. Available: ${openclawTools.map(t => t.name).join(", ")}`,
                isError: true,
            }],
        };
    }

    try {
        console.error(`[MCP Adapter] Executing tool: ${toolName}`);

        // AgentTool.execute() signature:
        //   execute(toolCallId: string, params: object, signal?: AbortSignal, onUpdate?: callback)
        // - toolCallId: a unique ID for this invocation (used for process tracking)
        // - params: the tool arguments from the MCP request
        // - signal: optional AbortSignal for cancellation
        // - onUpdate: optional callback for intermediate progress
        const toolCallId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const result = await targetTool.execute(
            toolCallId,
            toolArgs,
            undefined, // no AbortSignal for now
            (update) => {
                // Log intermediate updates to stderr (not visible to Gemini CLI)
                console.error(`[MCP Adapter] ${toolName} [update]:`, JSON.stringify(update).slice(0, 200));
            }
        );

        // Normalize the AgentToolResult to MCP content format
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
