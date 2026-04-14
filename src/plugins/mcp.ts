import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Server }                         from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport }  from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError }
  from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, TOOL_MAP, dispatchTool }  from "../tools/registry.js";
import { requestContext }                 from "../request-context.js";
import { record, recordAgentConnect }      from "./dashboard.js";
import { debugLog }                       from "../util.js";

function buildMcpServer(projectId: string, agentId: string): Server {
  const server = new Server(
    { name: "local-rag", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
  );

  // Fire when the MCP initialize handshake completes — agent is now connected.
  server.oninitialized = () => { recordAgentConnect(projectId, agentId); };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const a        = (request.params.arguments ?? {}) as Record<string, unknown>;
    const bytesIn  = JSON.stringify(a).length;
    const t0       = Date.now();

    debugLog("mcp", `tool=${name}`);

    const tool = TOOL_MAP.get(name);
    if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);

    const required = (tool.inputSchema.required ?? []) as string[];
    const missing  = required.filter(k => !(k in a));
    if (missing.length > 0)
      throw new McpError(ErrorCode.InvalidParams, `Missing required argument(s): ${missing.join(", ")}`);

    try {
      const text    = await dispatchTool(name, a);
      const elapsed = Date.now() - t0;
      record(name, "mcp", bytesIn, text.length, elapsed, true);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const elapsed = Date.now() - t0;
      const errStr  = err instanceof Error ? err.message : String(err);
      record(name, "mcp", bytesIn, 0, elapsed, false, errStr);
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, errStr);
    }
  });

  return server;
}

async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const q         = req.query as Record<string, string>;
  const projectId = q["project"] ?? "default";
  const agentId   = q["agent"]   ?? "default";

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = buildMcpServer(projectId, agentId);
  await mcpServer.connect(transport);

  await requestContext.run({ projectId, agentId }, async () => {
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  await mcpServer.close();
}

export async function mcpPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser("application/json", { parseAs: "string" },
    (_req, body, done) => {
      try { done(null, JSON.parse(body as string)); }
      catch (e) { done(e as Error); }
    }
  );

  fastify.post("/mcp",    handleMcpRequest);
  fastify.get("/mcp",     handleMcpRequest);
  fastify.delete("/mcp",  handleMcpRequest);
}
