import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { resolve } from "node:path";
import { statSync } from "node:fs";
import { ensureCollections, qd, colName } from "./qdrant.js";
import { record, startDashboard, broadcastShutdown, broadcastError, startReindex, tickReindex, endReindex } from "./dashboard.js";
import { CodeIndexer }  from "./indexer/indexer.js";
import { startWatcher } from "./indexer/watcher.js";
import { cfg, setCurrentBranch } from "./config.js";
import { debugLog } from "./util.js";
import { getCurrentBranch, isGitRepo, loadGitState, saveGitState } from "./indexer/git.js";
import { buildProjectProfile } from "./archivist.js";
import { TOOLS, TOOL_MAP, dispatchTool } from "./tools/registry.js";


// ── Connection-time instructions snapshot ────────────────────────────────────

async function buildConnectionInstructions(): Promise<string> {
  const symbolCount = await qd
    .count(colName("code_chunks"), {
      filter: { must: [{ key: "project_id", match: { value: cfg.projectId } }] },
    })
    .then((r) => r.count)
    .catch(() => 0);

  const gitState    = await loadGitState().catch(() => null);
  const lastIndexed = gitState?.lastIndexTimestamp
    ? new Date(gitState.lastIndexTimestamp).toISOString().slice(0, 16).replace("T", " ")
    : "unknown";

  const MEMORY_BASES = ["memory_episodic", "memory_semantic", "memory_procedural"] as const;
  const STATUS_SET   = new Set(["in_progress", "resolved", "open_question", "hypothesis"]);
  type Entry = { content: string; updatedAt: string; status: string };
  const all: Entry[] = [];

  await Promise.all(
    MEMORY_BASES.map(async (base) => {
      const result = await qd
        .scroll(colName(base), {
          filter:       { must: [{ key: "project_id", match: { value: cfg.projectId } }] },
          limit:        500,
          with_payload: ["content", "updated_at", "tags", "memory_type"],
          with_vector:  false,
        })
        .catch(() => ({ points: [] as Array<{ payload?: Record<string, unknown> }> }));

      for (const pt of result.points as Array<{ payload?: Record<string, unknown> }>) {
        const p       = (pt.payload ?? {}) as Record<string, unknown>;
        const content = typeof p["content"]     === "string" ? p["content"]     : "";
        const updated = typeof p["updated_at"]  === "string" ? p["updated_at"]  : "";
        const tags    = Array.isArray(p["tags"]) ? (p["tags"] as string[])      : [];
        const mtype   = typeof p["memory_type"] === "string" ? p["memory_type"] : base.replace("memory_", "");
        const status  = tags.find((t) => STATUS_SET.has(t)) ?? mtype;
        all.push({ content, updatedAt: updated, status });
      }
    })
  );

  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const today    = new Date().toISOString().slice(0, 10);
  const inProg   = all.filter((e) => e.status === "in_progress");
  const openQ    = all.filter((e) => e.status === "open_question");
  const resToday = all.filter((e) => e.status === "resolved" && e.updatedAt.startsWith(today));
  const recent   = all.slice(0, 5);

  const lines: string[] = [];
  lines.push(`Project: ${cfg.projectId}`);
  lines.push(`Indexed: ${symbolCount} symbols, last updated ${lastIndexed}`);
  lines.push("");
  lines.push("Memory state:");

  if (all.length === 0) {
    lines.push("  No entries. First session — nothing to recall.");
  } else {
    const fmt = (entries: Entry[], max = 3) =>
      entries
        .slice(0, max)
        .map((e) => (e.content.length > 70 ? e.content.slice(0, 70) + "\u2026" : e.content))
        .join("; ");

    if (inProg.length   > 0) lines.push(`  In progress (${inProg.length}): ${fmt(inProg)}`);
    if (openQ.length    > 0) lines.push(`  Open questions (${openQ.length}): ${fmt(openQ)}`);
    if (resToday.length > 0) lines.push(`  Resolved today (${resToday.length}): ${fmt(resToday)}`);
    if (inProg.length === 0 && openQ.length === 0 && resToday.length === 0)
      lines.push(`  ${all.length} entries (all ${all[0]?.status ?? "semantic"})`);

    lines.push("");
    lines.push("Recent activity:");
    for (const e of recent) {
      const ts    = e.updatedAt ? e.updatedAt.slice(0, 16).replace("T", " ") : "?";
      const short = e.content.length > 75 ? e.content.slice(0, 75) + "\u2026" : e.content;
      lines.push(`  [${e.status}] ${short} (${ts})`);
    }
  }

  return lines.join("\n");
}


// ── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "Claude Memory + Code RAG", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const a = (request.params.arguments ?? {}) as Record<string, unknown>;

  const bytesIn = JSON.stringify(a).length;
  const t0 = Date.now();

  debugLog("server", `tool=${name} args=${JSON.stringify(a).slice(0, 200)}`);

  try {
    // 1. Validate tool exists
    const tool = TOOL_MAP.get(name);
    if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);

    // 2. Validate required arguments are present
    const required = (tool.inputSchema.required ?? []) as string[];
    const missing = required.filter(k => !(k in a));
    if (missing.length > 0)
      throw new McpError(ErrorCode.InvalidParams, `Missing required argument(s): ${missing.join(", ")}`);

    // 3. Execute
    const text = await dispatchTool(name, a);
    const elapsed = Date.now() - t0;
    record(name, "mcp", bytesIn, text.length, elapsed, true);
    debugLog("server", `tool=${name} done bytes_out=${text.length} ms=${elapsed}`);
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const errStr = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const elapsed = Date.now() - t0;
    record(name, "mcp", bytesIn, 0, elapsed, false, errStr);
    debugLog("server", `tool=${name} error ms=${elapsed} ${errStr.slice(0, 200)}`);
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, err instanceof Error ? err.message : String(err));
  }
});

// ── Global error capture ─────────────────────────────────────────────────────

process.on("uncaughtException", (err: Error) => {
  process.stderr.write(`[memory] uncaughtException: ${err.stack ?? err.message}\n`);
  if (cfg.dashboard) broadcastError(err);
  setTimeout(() => process.exit(1), 250);
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  process.stderr.write(`[memory] unhandledRejection: ${err.stack ?? err.message}\n`);
  if (cfg.dashboard) broadcastError(err);
  setTimeout(() => process.exit(1), 250);
});

// ── Startup ──────────────────────────────────────────────────────────────────

await ensureCollections();

// Build project profile for the archivist (non-blocking — failure is logged, not fatal).
buildProjectProfile().catch((err: unknown) => {
  process.stderr.write(`[archivist] profile build failed: ${String(err)}\n`);
});

// Populate MCP instructions with a live snapshot of project state.
// Runs once at connection time so Claude immediately knows the memory state.
const _connInstructions = await buildConnectionInstructions().catch(() => "Memory snapshot unavailable.");
(server as unknown as { _instructions?: string })._instructions = _connInstructions;

if (cfg.dashboard) startDashboard(cfg.dashboardPort, TOOLS, dispatchTool);
if (cfg.watch) {
  const root    = cfg.projectRoot || process.cwd();
  const absRoot = resolve(root);
  const currentBranch = isGitRepo(root) ? getCurrentBranch(root) : "default";
  setCurrentBranch(currentBranch);
  const indexer = new CodeIndexer({
    generateDescriptions: cfg.generateDescriptions,
    branch: currentBranch,
  });

  const onReindex = (relPath: string, chunks: number) => {
    server.notification({
      method: "notifications/message",
      params: { level: "info", logger: "watcher", data: `Reindexed ${relPath}: ${chunks} chunks` },
    }).catch((err: unknown) => {
      process.stderr.write(`[watcher] notification error: ${String(err)}\n`);
    });
  };

  // ── Git-aware startup ──────────────────────────────────────────────────────
  const lastState = await loadGitState().catch(() => null);

  const startWatcherAfterIndex = () => {
    saveGitState({
      lastBranch: currentBranch,
      lastIndexTimestamp: Date.now(),
      lastGcTimestamp: lastState?.lastGcTimestamp,
    }).catch(() => undefined);
    startWatcher(root, indexer, onReindex, undefined, true);
  };

  if (!lastState) {
    // First run: full scan with branch tagging
    process.stderr.write(`[indexer] First run — full index on branch "${currentBranch}"\n`);
    const files = indexer.collectFiles(absRoot);
    startReindex(files.length);
    indexer.indexAll(absRoot, {
      suppressCountLog: true,
      onProgress: (_done, _total, chunks) => tickReindex(chunks),
    }).then(() => {
      endReindex();
      startWatcherAfterIndex();
    }).catch((err: unknown) => {
      process.stderr.write(`[indexer] initial scan error: ${String(err)}\n`);
      endReindex();
      startWatcherAfterIndex();
    });
  } else if (lastState.lastBranch !== currentBranch) {
    // Branch changed while server was down — switchBranch
    process.stderr.write(`[indexer] Branch changed: ${lastState.lastBranch} → ${currentBranch}\n`);
    indexer.switchBranch(root, lastState.lastBranch, currentBranch).then(() => {
      startWatcherAfterIndex();
    }).catch((err: unknown) => {
      process.stderr.write(`[indexer] branch switch error: ${String(err)}\n`);
      startWatcherAfterIndex();
    });
  } else {
    // Same branch — mtime optimization: only reindex files modified since last index
    process.stderr.write(`[indexer] Startup on branch "${currentBranch}" — mtime check\n`);
    const files = indexer.collectFiles(absRoot);
    const staleFiles = files.filter((f) => {
      try {
        return statSync(f).mtimeMs > lastState.lastIndexTimestamp;
      } catch { return true; }
    });

    if (staleFiles.length > 0) {
      process.stderr.write(`[indexer] ${staleFiles.length}/${files.length} files modified since last run\n`);
      startReindex(staleFiles.length);
      let done = 0;
      const processStale = async () => {
        // Ensure migration has been run for existing chunks
        await indexer.migrateBranches(currentBranch, absRoot).catch(() => undefined);
        for (const absPath of staleFiles) {
          await indexer.indexFileIncremental(absPath, absRoot).catch((err: unknown) => {
            process.stderr.write(`[indexer] ${absPath}: ${String(err)}\n`);
          });
          done++;
          tickReindex(0);
        }
      };
      processStale().then(() => {
        endReindex();
        startWatcherAfterIndex();
      }).catch((err: unknown) => {
        process.stderr.write(`[indexer] mtime scan error: ${String(err)}\n`);
        endReindex();
        startWatcherAfterIndex();
      });
    } else {
      process.stderr.write(`[indexer] No files modified — skipping reindex\n`);
      // Still ensure migration is done
      indexer.migrateBranches(currentBranch, absRoot).then(() => {
        startWatcherAfterIndex();
      }).catch(() => {
        startWatcherAfterIndex();
      });
    }
  }
}
process.stderr.write("[memory] MCP server ready\n");

const transport = new StdioServerTransport();
await server.connect(transport);

process.stdin.once("close", () => {
  if (cfg.dashboard) broadcastShutdown();
  server.close().finally(() => process.exit(0));
});
