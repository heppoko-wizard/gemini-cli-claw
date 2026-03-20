import type { OpenClawPluginApi, GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";

export default function register(api: OpenClawPluginApi) {
  api.logger.info("MCP Gateway Plugin Initializing...");
  const REGISTRY_SYMBOL = Symbol.for("openclaw.pluginRegistryState");

  function getPluginRegistry() {
    return (globalThis as any)[REGISTRY_SYMBOL]?.registry;
  }

  function getToolContext(opts: GatewayRequestHandlerOptions) {
    return {
      config: api.config,
      workspaceDir: api.resolvePath("./workspace"),
      agentDir: api.resolvePath("./agents"),
      logGateway: opts.context.logGateway
    };
  }

  api.registerGatewayMethod("mcp.listTools", async (opts: GatewayRequestHandlerOptions) => {
    try {
      const registry = getPluginRegistry();
      if (!registry) {
        throw new Error("Plugin registry not available.");
      }

      const context = getToolContext(opts);
      const tools: any[] = [];

      for (const entry of registry.tools) {
          try {
              const resolved = entry.factory(context);
              if (!resolved) continue;
              const list = Array.isArray(resolved) ? resolved : [resolved];
              tools.push(...list);
          } catch (e) {
              api.logger.warn(`Failed to resolve tools for plugin ${entry.pluginId}: ${e}`);
          }
      }

      const mcpTools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "No description provided.",
        inputSchema: tool.parameters
      }));

      opts.respond(true, { tools: mcpTools });
    } catch (error) {
      api.logger.error(`mcp.listTools error: ${error}`);
      opts.respond(false, undefined, { code: 500, message: String(error) });
    }
  });

  api.registerGatewayMethod("mcp.callTool", async (opts: GatewayRequestHandlerOptions) => {
    try {
      const params = opts.params as { name?: string; arguments?: Record<string, unknown> };
      if (!params || typeof params.name !== "string") {
        opts.respond(false, undefined, { code: 400, message: "Invalid params: name is required." });
        return;
      }

      const registry = getPluginRegistry();
      if (!registry) {
        throw new Error("Plugin registry not available.");
      }

      const context = getToolContext(opts);
      let targetTool: any = null;

      for (const entry of registry.tools) {
          try {
              const resolved = entry.factory(context);
              if (!resolved) continue;
              const list = Array.isArray(resolved) ? resolved : [resolved];
              targetTool = list.find((t: any) => t.name === params.name);
              if (targetTool) break;
          } catch (e) {
              api.logger.warn(`Failed to resolve tools for plugin ${entry.pluginId}: ${e}`);
          }
      }

      if (!targetTool) {
        opts.respond(false, undefined, { code: 404, message: `Tool not found: ${params.name}` });
        return;
      }

      const toolCallId = `mcp_call_${Date.now()}`;
      const result = await targetTool.execute(toolCallId, params.arguments || {});

      opts.respond(true, result);
    } catch (error) {
      api.logger.error(`mcp.callTool error: ${error}`);
      opts.respond(false, undefined, { code: 500, message: String(error) });
    }
  });
}
