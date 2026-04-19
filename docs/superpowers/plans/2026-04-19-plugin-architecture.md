# Plugin Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert local-rag from a manual `local-rag init` setup flow into a Claude Code plugin + Gemini extension, with `project_dir`-based project resolution and full removal of the `agent` concept.

**Architecture:** A single persistent HTTP server (`local-rag serve`) serves all projects. A plugin package installed once per user auto-registers hooks and declares the MCP server via `.mcp.json` using `${CLAUDE_PROJECT_DIR}`. The server resolves the project by matching `project_dir` against registered project roots; unknown directories auto-create a project on first request.

**Tech Stack:** TypeScript/Node.js, Fastify, Qdrant, MCP Streamable HTTP transport, Angular (dashboard UI)

---

## File Map

**Modified:**
- `src/request-context.ts` — remove `agentId` from `RequestCtx`
- `src/session-store.ts` — key on `projectId` only (remove `agentId` param)
- `src/session-store.test.ts` — update tests
- `src/server-config.ts` — remove `agent_id`, rename `project_root` → `project_dir`, add `findProjectByDir()`
- `src/server-config.test.ts` — update `mergeProjectConfig` test
- `src/plugins/mcp.ts` — accept `project_dir` query param, resolve project
- `src/plugins/hooks.ts` — accept `project_dir`, remove `agent` query params
- `src/plugins/dashboard.ts` — remove agent tracking, use `project_dir`
- `src/hook-recall.ts` — pass `--project-dir` instead of `--project/--agent`
- `src/hook-remember.ts` — same
- `src/hook-session-end.ts` — same
- `src/hook-session-start.ts` — use `CLAUDE_PROJECT_DIR`
- `src/tools/give_feedback.ts` — remove `getAgentId()`
- `src/indexer/worker.ts` — use `project_dir` from `ProjectConfig`
- `src/config.ts` — rename `projectRoot` → `projectDir`
- `src/migrate.ts` — `project_root` → `project_dir`
- `src/tools/get_file_context.ts` — `projectRoot` → `projectDir`
- `src/tools/project_overview.ts` — `projectRoot` → `projectDir`
- `src/indexer/cli.ts` — `projectRoot` → `projectDir`
- `src/indexer/watcher.ts` — `projectRoot` → `projectDir`
- `src/dashboard-ui/src/types.ts` — remove `agentId`, rename `project_root`
- `src/dashboard-ui/src/app/components/settings.component.ts` — remove agent field
- `src/dashboard-ui/src/app/components/playground.component.ts` — remove `agent_id`
- `src/dashboard-ui/src/app/services/sse.service.ts` — remove agent SSE events
- `src/dashboard-ui/src/app/app.component.ts` — remove `agentStatus`
- `src/init.ts` — deprecation notice

**Created:**
- `.claude-plugin/plugin.json`
- `.mcp.json`
- `hooks/hooks.json`
- `hooks/session-start.mjs`
- `hooks/recall.mjs`
- `hooks/remember.mjs`
- `hooks/session-end.mjs`
- `CLAUDE.md` (plugin root, replaces in-server instructions)
- `GEMINI.md`
- `gemini-extension.json`

---

### Task 1: Remove agent from request-context and session-store

**Files:**
- Modify: `src/request-context.ts`
- Modify: `src/session-store.ts`
- Modify: `src/session-store.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace `src/session-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { setSession, getSession, clearStore } from "./session-store.js";

beforeEach(() => clearStore());

describe("SessionStore", () => {
  it("returns undefined when nothing stored", () => {
    expect(getSession("proj")).toBeUndefined();
  });

  it("stores and retrieves session_id", () => {
    setSession("proj", "sess-123");
    expect(getSession("proj")).toBe("sess-123");
  });

  it("overwrites previous session_id", () => {
    setSession("proj", "old");
    setSession("proj", "new");
    expect(getSession("proj")).toBe("new");
  });

  it("returns undefined for expired entries", () => {
    setSession("proj", "expired", -1);
    expect(getSession("proj")).toBeUndefined();
  });

  it("different project keys are independent", () => {
    setSession("proj-a", "sess-a");
    setSession("proj-b", "sess-b");
    expect(getSession("proj-a")).toBe("sess-a");
    expect(getSession("proj-b")).toBe("sess-b");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/session-store.test.ts
```
Expected: FAIL — `getSession` called with wrong arity.

- [ ] **Step 3: Update `src/session-store.ts`**

```typescript
interface SessionInfo {
  sessionId: string;
  expiresAt: number;
}

const TTL_MS = 3_600_000;
const store  = new Map<string, SessionInfo>();

export function setSession(projectId: string, sessionId: string, ttlMs = TTL_MS): void {
  store.set(projectId, { sessionId, expiresAt: Date.now() + ttlMs });
}

export function getSession(projectId: string): string | undefined {
  const info = store.get(projectId);
  if (!info) return undefined;
  if (Date.now() > info.expiresAt) { store.delete(projectId); return undefined; }
  return info.sessionId;
}

export function clearStore(): void { store.clear(); }
```

- [ ] **Step 4: Update `src/request-context.ts`**

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestCtx {
  projectId: string;
}

const _store = new AsyncLocalStorage<RequestCtx>();

export const requestContext = _store;

export function runWithContext<T>(ctx: RequestCtx, fn: () => T): T {
  return _store.run(ctx, fn);
}

export function getProjectId(): string {
  return _store.getStore()?.projectId ?? "default";
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm vitest run src/session-store.test.ts
```
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/request-context.ts src/session-store.ts src/session-store.test.ts
git commit -m "refactor: remove agent from request-context and session-store"
```

---

### Task 2: Remove agent_id from ProjectConfig

**Files:**
- Modify: `src/server-config.ts`
- Modify: `src/server-config.test.ts`

- [ ] **Step 1: Update `mergeProjectConfig` test**

In `src/server-config.test.ts`, update the `mergeProjectConfig` describe block:
```typescript
describe("mergeProjectConfig", () => {
  it("returns default project with provided project_id", () => {
    const p = mergeProjectConfig({ project_id: "myproj" });
    expect(p.project_id).toBe("myproj");
    expect(p.indexer_state).toBe("stopped");
    expect(p.include_paths).toEqual([]);
    expect((p as Record<string, unknown>)["agent_id"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm vitest run src/server-config.test.ts
```
Expected: FAIL — `agent_id` exists on the object.

- [ ] **Step 3: Update `ProjectConfig` in `src/server-config.ts`**

Replace the `ProjectConfig` interface and `mergeProjectConfig` (lines 43–87):
```typescript
export interface ProjectConfig {
  project_id:    string;
  display_name:  string;
  project_dir:   string;
  include_paths: string[];
  indexer_state: IndexerState;
  created_at:    string;
  updated_at:    string;
}

export function mergeProjectConfig(raw: Partial<ProjectConfig> & { project_id: string }): ProjectConfig {
  const now = new Date().toISOString();
  return {
    project_id:    raw.project_id,
    display_name:  raw.display_name  ?? raw.project_id,
    project_dir:   raw.project_dir   ?? "",
    include_paths: raw.include_paths ?? [],
    indexer_state: raw.indexer_state ?? "stopped",
    created_at:    raw.created_at    ?? now,
    updated_at:    raw.updated_at    ?? now,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/server-config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Fix TypeScript errors**

```bash
pnpm tsc --noEmit 2>&1 | grep "agent_id\|project_root" | head -20
```
Fix any remaining `agent_id` or `project_root` references in server-config consumers (only `src/plugins/dashboard.ts` and `src/indexer/worker.ts` should surface — those are fixed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/server-config.ts src/server-config.test.ts
git commit -m "refactor: remove agent_id from ProjectConfig, rename project_root to project_dir"
```

---

### Task 3: Remove agent from hook CLI scripts

**Files:**
- Modify: `src/hook-recall.ts`
- Modify: `src/hook-remember.ts`
- Modify: `src/hook-session-end.ts`
- Modify: `src/hook-session-start.ts`

- [ ] **Step 1: Update `src/hook-recall.ts`**

```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookRecall(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) { process.stdout.write("{}"); return; }

  let projectDir = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-dir" && args[i + 1]) { projectDir = args[i + 1]!; i++; }
  }

  const localCfg  = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  const url = new URL(`${serverUrl}/hooks/recall`);
  if (projectDir) url.searchParams.set("project_dir", projectDir);

  try {
    const res = await fetch(url.toString(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body, signal: AbortSignal.timeout(120_000),
    });
    process.stdout.write(res.ok ? await res.text() : "{}");
  } catch {
    process.stdout.write("{}");
  }
}
```

- [ ] **Step 2: Update `src/hook-remember.ts`**

Read current file first: `cat src/hook-remember.ts`

Replace `--project` / `--agent` arg parsing with `--project-dir`:
```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookRemember(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) { process.stdout.write("{}"); return; }

  let projectDir = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-dir" && args[i + 1]) { projectDir = args[i + 1]!; i++; }
  }

  const localCfg  = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  const url = new URL(`${serverUrl}/hooks/remember`);
  if (projectDir) url.searchParams.set("project_dir", projectDir);

  try {
    const res = await fetch(url.toString(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body, signal: AbortSignal.timeout(120_000),
    });
    process.stdout.write(res.ok ? await res.text() : "{}");
  } catch {
    process.stdout.write("{}");
  }
}
```

- [ ] **Step 3: Update `src/hook-session-end.ts`**

Read current file first: `cat src/hook-session-end.ts`

Replace with (remove `--agent` and `--agent-type`):
```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookSessionEnd(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();

  let projectDir = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-dir" && args[i + 1]) { projectDir = args[i + 1]!; i++; }
  }

  const localCfg  = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  const url = new URL(`${serverUrl}/hooks/session-end`);
  if (projectDir) url.searchParams.set("project_dir", projectDir);

  try {
    const res = await fetch(url.toString(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: body || "{}", signal: AbortSignal.timeout(30_000),
    });
    process.stdout.write(res.ok ? await res.text() : "{}");
  } catch {
    process.stdout.write("{}");
  }
}
```

- [ ] **Step 4: Update `src/hook-session-start.ts`**

Replace with (add auto-registration):
```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";
import { basename } from "node:path";

const SESSION_START_MESSAGE = `Memory system active (local-rag). See MCP server instructions for the full protocol.`;

export async function runHookSessionStart(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

  let projectDir = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-dir" && args[i + 1]) { projectDir = args[i + 1]!; i++; }
  }

  if (projectDir) {
    const localCfg  = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
    const port      = localCfg?.port ?? 7531;
    const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;
    await fetch(`${serverUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: basename(projectDir), display_name: basename(projectDir), project_dir: projectDir }),
    }).catch(() => null);
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: SESSION_START_MESSAGE },
  }));
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep "hook-"
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hook-recall.ts src/hook-remember.ts src/hook-session-end.ts src/hook-session-start.ts
git commit -m "refactor: replace --project/--agent args with --project-dir in hook scripts"
```

---

### Task 4: Remove agent from server plugins (hooks.ts, mcp.ts, dashboard.ts)

**Files:**
- Modify: `src/plugins/hooks.ts`
- Modify: `src/plugins/mcp.ts`
- Modify: `src/plugins/dashboard.ts`

- [ ] **Step 1: Update `src/plugins/hooks.ts`** — remove `agentId` from all three hook endpoints and route signatures

In `/hooks/recall` route (line 162), change to:
```typescript
fastify.post<{ Body: HookBody; Querystring: { project_dir?: string } }>("/hooks/recall", async (req, reply) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req.raw) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");

  const projectDir = req.query.project_dir ?? "";
  const projectId  = projectDir ? basename(projectDir) : "default";

  return runWithContext({ projectId }, async () => {
    // ... rest of recall logic unchanged except remove all agentId references
  });
});
```

Add `import { basename } from "node:path";` at top.

In `/hooks/remember` route (line 220), same pattern:
```typescript
fastify.post<{ Body: HookBody; Querystring: { project_dir?: string } }>("/hooks/remember", async (req, reply) => {
  const projectDir    = req.query.project_dir ?? "";
  const projectId     = projectDir ? basename(projectDir) : "default";
  // remove agentId, finalAgentId — use projectId only
  // change memory_agents collection to memory (remove multi-agent distinction)
  return runWithContext({ projectId }, async () => { ... });
});
```

In `/hooks/session-end` route (line 315):
```typescript
fastify.post<{ Body: HookBody; Querystring: { project_dir?: string } }>("/hooks/session-end", async (req, reply) => {
  const projectDir = req.query.project_dir ?? "";
  const projectId  = projectDir ? basename(projectDir) : "default";
  return runWithContext({ projectId }, async () => {
    // remove agentId, agentType
    // setSession(projectId, sessionId)
    // recordAgentDisconnect(projectId)
    // remove agent_id, agent_type from persistHookCall payload
  });
});
```

Remove `detectSessionType` function's `agentId` return field — just return `{ type, threshold }`.

Remove `import { setSession, getSession }` → `import { setSession }` (getSession was used with agentId).

- [ ] **Step 2: Update `src/plugins/mcp.ts`** — remove agentId from buildMcpServer and handleMcpRequest

```typescript
function buildMcpServer(projectId: string): Server {
  const server = new Server(
    { name: "local-rag", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  server.oninitialized = () => { recordAgentConnect(projectId); };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const a = (request.params.arguments ?? {}) as Record<string, unknown>;
    const bytesIn = JSON.stringify(a).length;
    const t0 = Date.now();
    const tool = TOOL_MAP.get(name);
    if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    const required = (tool.inputSchema.required ?? []) as string[];
    const missing = required.filter(k => !(k in a));
    if (missing.length > 0)
      throw new McpError(ErrorCode.InvalidParams, `Missing required argument(s): ${missing.join(", ")}`);
    try {
      const text = await dispatchTool(name, a);
      const elapsed = Date.now() - t0;
      record(name, "mcp", bytesIn, text.length, elapsed, true);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const elapsed = Date.now() - t0;
      const errStr = err instanceof Error ? err.message : String(err);
      record(name, "mcp", bytesIn, 0, elapsed, false, errStr);
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, errStr);
    }
  });
  return server;
}

async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const q          = req.query as Record<string, string>;
  const projectId  = q["project"] ?? "default";

  const transport  = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer  = buildMcpServer(projectId);
  await mcpServer.connect(transport);

  await requestContext.run({ projectId }, async () => {
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  await mcpServer.close();
}
```

Note: `project_dir` resolution is added in Task 8.

- [ ] **Step 3: Update `src/plugins/dashboard.ts`** — remove agentId from tracking functions

Change `recordAgentConnect` and `recordAgentDisconnect` signatures:
```typescript
export function recordAgentConnect(projectId: string): void {
  if (!_active) return;
  const ts = Date.now();
  lastAgentConnect.set(projectId, { ts });
  const data = `data: ${JSON.stringify({ type: "agent-connect", projectId, ts })}\n\n`;
  for (const res of new Set(sseClients)) res.write(data);
}

export function recordAgentDisconnect(projectId: string): void {
  if (!_active) return;
  lastAgentConnect.delete(projectId);
  const data = `data: ${JSON.stringify({ type: "agent-disconnect", projectId })}\n\n`;
  for (const res of new Set(sseClients)) res.write(data);
}
```

Change `lastAgentConnect` map type: `Map<string, { ts: number }>`.

In `serverInfo()`, remove `agentId: getAgentIdCtx()`. Remove the `getAgentId as getAgentIdCtx` import.

In `record()` function (line ~83), remove `agentId: getAgentIdCtx()` from entry construction.

In `recordIndex()` (line ~124), remove `agentId: "indexer"` from entry construction.

Update SSE `/api/memory/search` route: remove `agent_id` query param.

In `/api/run` route (line 571), remove `agent_id` from body type.

- [ ] **Step 4: Fix give_feedback.ts — remove agentId**

In `src/tools/give_feedback.ts`, remove `getAgentId` usage:
```typescript
import { getProjectId }    from "../request-context.js";
// remove: import { getAgentId } ... or getAgentId from request-context

export async function giveFeedbackTool(a: GiveFeedbackArgs): Promise<string> {
  const projectId = getProjectId();
  // remove: const agentId = getAgentId();
  const sessionId = a.session_id || getSession(projectId) || "unknown";
  // remove agentId from payload
}
```

Also update `getSession` call: `getSession(projectId)` (no agent arg after Task 1).

- [ ] **Step 5: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "dashboard-ui\|node_modules" | head -30
```
Expected: only dashboard-ui errors (fixed in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/plugins/hooks.ts src/plugins/mcp.ts src/plugins/dashboard.ts src/tools/give_feedback.ts
git commit -m "refactor: remove agent from server plugins"
```

---

### Task 5: Remove agent from dashboard UI

**Files:**
- Modify: `src/dashboard-ui/src/types.ts`
- Modify: `src/dashboard-ui/src/app/services/sse.service.ts`
- Modify: `src/dashboard-ui/src/app/app.component.ts`
- Modify: `src/dashboard-ui/src/app/components/settings.component.ts`
- Modify: `src/dashboard-ui/src/app/components/playground.component.ts`

- [ ] **Step 1: Update `src/dashboard-ui/src/types.ts`**

In `RequestEntry` (line ~16), remove `agentId?: string`.
In `ServerInfo` (line ~44), remove `agentId: string`.
In the SSE init event type (line ~97), change `agentConnections` type to `Record<string, { ts: number }>`.
In `ProjectConfig` (line ~130), remove `agent_id: string`, rename `project_root: string` → `project_dir: string`.

- [ ] **Step 2: Update `src/dashboard-ui/src/app/services/sse.service.ts`**

Change `agentConnections` signal type to `signal<Record<string, { ts: number }>>({})`.
Update the SSE message union types — remove `agentId` from `agent-connect` and `agent-disconnect` events.
In the `agent-connect` handler, remove `agentId` from the stored value.

- [ ] **Step 3: Update `src/dashboard-ui/src/app/app.component.ts`**

Remove the `agentStatus` computed signal (lines 76–83) and `fmtAgo` method.
Remove any template binding for agent status (check `app.component.html` first with `cat`).

- [ ] **Step 4: Update `src/dashboard-ui/src/app/components/settings.component.ts`**

Remove the `agent_id` form field (lines 23–24). Change `project_root` field binding to `project_dir`.

- [ ] **Step 5: Update `src/dashboard-ui/src/app/components/playground.component.ts`**

Remove `agent_id: "playground"` from the `/api/run` request body (line 122).

- [ ] **Step 6: Build the UI to verify**

```bash
pnpm build:ui 2>&1 | tail -20
```
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard-ui/
git commit -m "refactor: remove agent from dashboard UI, rename project_root to project_dir"
```

---

### Task 6: Rename project_root → project_dir in server-side consumers

**Files:**
- Modify: `src/config.ts` (projectRoot → projectDir)
- Modify: `src/indexer/worker.ts`
- Modify: `src/indexer/cli.ts`
- Modify: `src/indexer/watcher.ts`
- Modify: `src/plugins/dashboard.ts`
- Modify: `src/tools/get_file_context.ts`
- Modify: `src/tools/project_overview.ts`
- Modify: `src/migrate.ts`

- [ ] **Step 1: Update `src/config.ts`** — rename `projectRoot` → `projectDir`

Find `projectRoot` in config interface and default object, rename to `projectDir`. Also update wherever `cfg.projectRoot` is read in these tool files.

- [ ] **Step 2: Update `src/tools/get_file_context.ts`**

```typescript
const projectDir = cfg.projectDir || process.cwd();
const absPath    = resolve(join(projectDir, a.file_path));
```

- [ ] **Step 3: Update `src/tools/project_overview.ts`**

```typescript
const root = resolve(cfg.projectDir || process.cwd());
```

- [ ] **Step 4: Update `src/indexer/cli.ts`**

Replace `cfg.projectRoot` → `cfg.projectDir`.

- [ ] **Step 5: Update `src/indexer/worker.ts`**

Replace `projectConfig.project_root` → `projectConfig.project_dir` (both occurrences):
```typescript
const root = resolve(projectConfig.project_dir || ".");
// and:
projectDir: projectConfig.project_dir,
```

- [ ] **Step 6: Update `src/indexer/watcher.ts`**

Replace `indexer.projectRoot` → `indexer.projectDir`.

- [ ] **Step 7: Update `src/plugins/dashboard.ts`**

Replace `project?.project_root` → `project?.project_dir` (line ~138).

- [ ] **Step 8: Update `src/migrate.ts`**

Replace `project_root` → `project_dir` and `projectRoot` → `projectDir` throughout.

- [ ] **Step 9: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "dashboard-ui\|node_modules" | head -20
```
Expected: 0 errors outside dashboard-ui.

- [ ] **Step 10: Commit**

```bash
git add src/config.ts src/indexer/ src/plugins/dashboard.ts src/tools/get_file_context.ts src/tools/project_overview.ts src/migrate.ts
git commit -m "refactor: rename project_root to project_dir throughout server"
```

---

### Task 7: Add project_dir resolution to server-config, MCP, and hook endpoints

**Files:**
- Modify: `src/server-config.ts` — add `findProjectByDir()` and `upsertProjectByDir()`
- Modify: `src/plugins/mcp.ts` — resolve `project_dir` query param
- Modify: `src/plugins/hooks.ts` — resolve `project_dir` to `project_id` via server-config

- [ ] **Step 1: Write the failing test for `findProjectByDir`**

Add to `src/server-config.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { mergeProjectConfig } from "./server-config.js";

// Existing tests remain ...

describe("mergeProjectConfig project_dir", () => {
  it("stores project_dir", () => {
    const p = mergeProjectConfig({ project_id: "myapp", project_dir: "/home/user/myapp" });
    expect(p.project_dir).toBe("/home/user/myapp");
  });

  it("derives display_name from project_id when not provided", () => {
    const p = mergeProjectConfig({ project_id: "myapp" });
    expect(p.display_name).toBe("myapp");
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm vitest run src/server-config.test.ts
```
Expected: PASS (these should already pass after Task 2 changes).

- [ ] **Step 3: Add `findProjectByDir` to `src/server-config.ts`**

Add after `loadProjectConfig`:
```typescript
/** Find a project by its directory path. Returns null if not found. */
export async function findProjectByDir(qd: QdrantClient, projectDir: string): Promise<ProjectConfig | null> {
  const result = await qd.scroll(PROJECTS_COL, {
    filter: { must: [{ key: "project_dir", match: { value: projectDir } }] },
    limit: 1, with_payload: true, with_vector: false,
  }).catch(() => ({ points: [] as { payload?: Record<string, unknown> }[] }));
  const pt = result.points[0];
  if (!pt) return null;
  return mergeProjectConfig({
    ...(pt.payload as Partial<ProjectConfig>),
    project_id: String((pt.payload as Record<string, unknown>)["project_id"] ?? ""),
  });
}
```

- [ ] **Step 4: Update `src/plugins/mcp.ts`** — add project_dir resolution

Import `findProjectByDir` and `upsertProjectConfig` from server-config, import `qd` from qdrant, import `basename` from path.

Update `handleMcpRequest`:
```typescript
async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const q          = req.query as Record<string, string>;
  const projectDir = q["project_dir"];
  let   projectId  = q["project"] ?? "default";

  if (projectDir) {
    const { findProjectByDir, upsertProjectConfig, mergeProjectConfig } = await import("../server-config.js");
    const { qd } = await import("../qdrant.js");
    let project = await findProjectByDir(qd, projectDir);
    if (!project) {
      project = mergeProjectConfig({ project_id: basename(projectDir), project_dir: projectDir });
      await upsertProjectConfig(qd, project);
    }
    projectId = project.project_id;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = buildMcpServer(projectId);
  await mcpServer.connect(transport);

  await requestContext.run({ projectId }, async () => {
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  await mcpServer.close();
}
```

- [ ] **Step 5: Update `src/plugins/hooks.ts`** — resolve project_dir in all three hook routes

For all three routes, replace the `projectId = basename(projectDir)` shortcut with a lookup:
```typescript
async function resolveProjectId(projectDir: string): Promise<string> {
  if (!projectDir) return "default";
  const { findProjectByDir, upsertProjectConfig, mergeProjectConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  let project = await findProjectByDir(qd, projectDir);
  if (!project) {
    project = mergeProjectConfig({ project_id: basename(projectDir), project_dir: projectDir });
    await upsertProjectConfig(qd, project);
  }
  return project.project_id;
}
```

Call `resolveProjectId(projectDir)` at the start of each route handler. Add `import { basename } from "node:path";` at top.

- [ ] **Step 6: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "dashboard-ui\|node_modules" | head -20
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/server-config.ts src/server-config.test.ts src/plugins/mcp.ts src/plugins/hooks.ts
git commit -m "feat: add project_dir-based project resolution to MCP and hook endpoints"
```

---

### Task 8: Create plugin files

**Files (all new):**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `hooks/hooks.json`
- Create: `hooks/session-start.mjs`
- Create: `hooks/recall.mjs`
- Create: `hooks/remember.mjs`
- Create: `hooks/session-end.mjs`
- Create: `CLAUDE.md`
- Create: `GEMINI.md`
- Create: `gemini-extension.json`

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "local-rag",
  "description": "Persistent semantic memory and code intelligence. 9 tools that give Claude persistent memory, semantic code search, import graph traversal, and symbol-level navigation — all running locally.",
  "author": {
    "name": "Vladimir Bulyga",
    "email": "zero@13w.me"
  }
}
```

- [ ] **Step 2: Create `.mcp.json`**

```json
{
  "mcpServers": {
    "memory": {
      "type": "http",
      "url": "http://localhost:7531/mcp?project_dir=${CLAUDE_PROJECT_DIR}"
    }
  }
}
```

- [ ] **Step 3: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs\""
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/recall.mjs\""
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/remember.mjs\""
        }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end.mjs\""
        }]
      }
    ]
  }
}
```

- [ ] **Step 4: Create `hooks/session-start.mjs`**

```javascript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
// consume stdin (required by Claude Code hook contract)

async function readLocalConfig() {
  try {
    const raw = await readFile(join(homedir(), ".config", "local-rag", "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { port: 7531 };
  }
}

const localCfg  = await readLocalConfig();
const port      = localCfg.port ?? 7531;
const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

// Auto-register project (idempotent upsert)
await fetch(`${serverUrl}/api/projects`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify({
    project_id:   basename(projectDir),
    display_name: basename(projectDir),
    project_dir:  projectDir,
  }),
}).catch(() => null);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName:     "SessionStart",
    additionalContext: "Memory system active (local-rag). See MCP server instructions for the full protocol.",
  },
}));
```

- [ ] **Step 5: Create `hooks/recall.mjs`**

```javascript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const body = Buffer.concat(chunks).toString("utf8").trim();
if (!body) { process.stdout.write("{}"); process.exit(0); }

async function readLocalConfig() {
  try {
    const raw = await readFile(join(homedir(), ".config", "local-rag", "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { port: 7531 };
  }
}

const localCfg  = await readLocalConfig();
const port      = localCfg.port ?? 7531;
const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

const url = new URL(`${serverUrl}/hooks/recall`);
url.searchParams.set("project_dir", projectDir);

try {
  const res = await fetch(url.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal:  AbortSignal.timeout(120_000),
  });
  process.stdout.write(res.ok ? await res.text() : "{}");
} catch {
  process.stdout.write("{}");
}
```

- [ ] **Step 6: Create `hooks/remember.mjs`**

```javascript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const body = Buffer.concat(chunks).toString("utf8").trim();
if (!body) { process.stdout.write("{}"); process.exit(0); }

async function readLocalConfig() {
  try {
    const raw = await readFile(join(homedir(), ".config", "local-rag", "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { port: 7531 };
  }
}

const localCfg  = await readLocalConfig();
const port      = localCfg.port ?? 7531;
const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

const url = new URL(`${serverUrl}/hooks/remember`);
url.searchParams.set("project_dir", projectDir);

try {
  const res = await fetch(url.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal:  AbortSignal.timeout(120_000),
  });
  process.stdout.write(res.ok ? await res.text() : "{}");
} catch {
  process.stdout.write("{}");
}
```

- [ ] **Step 7: Create `hooks/session-end.mjs`**

```javascript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const body = Buffer.concat(chunks).toString("utf8").trim();

async function readLocalConfig() {
  try {
    const raw = await readFile(join(homedir(), ".config", "local-rag", "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { port: 7531 };
  }
}

const localCfg  = await readLocalConfig();
const port      = localCfg.port ?? 7531;
const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

const url = new URL(`${serverUrl}/hooks/session-end`);
url.searchParams.set("project_dir", projectDir);

try {
  const res = await fetch(url.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    body || "{}",
    signal:  AbortSignal.timeout(30_000),
  });
  process.stdout.write(res.ok ? await res.text() : "{}");
} catch {
  process.stdout.write("{}");
}
```

- [ ] **Step 8: Create `CLAUDE.md`**

```markdown
# local-rag — Persistent Memory + Code RAG

You have access to a persistent memory and code-RAG server for this project.
Treat it as your long-term memory: prior decisions, bug fixes, open questions,
and a semantic index of the codebase all live here. You have continuity across
sessions only through these tools.

## Core workflow

For any non-trivial task:

1. `recall(query)` — before starting. Past decisions, resolved bugs, open questions,
   work in progress. Skip only for trivial edits or pure syntax questions.
2. `search_code(query)` — locate code by meaning, not filename. Use when you
   don't know where something lives.
3. [think + act]
4. `remember(content, memory_type, importance)` — the moment you learn something:
   a bug's root cause, a non-obvious pattern, a command that works, an API constraint.
   One fact per call. Without this, knowledge is lost at session end.

## Memory types

- `episodic` — events, bugs, incidents (time-decayed)
- `semantic` — facts, architecture, decisions (long-lived)
- `procedural` — patterns, conventions, how-to (long-lived)

## Status on recall results

- `open_question` / `in_progress` — active agenda, needs attention
- `resolved` — closed, do not reopen without new information
- `hypothesis` — proposed direction, not yet validated

## Anti-patterns

- Batching `remember()` at session end — knowledge decays, call it immediately
- Skipping `recall()` because "I know this codebase" — you don't remember past sessions
- Ignoring `search_code` in favour of Read/grep on unfamiliar repos
```

- [ ] **Step 9: Create `GEMINI.md`**

Same content as `CLAUDE.md` — Gemini extension loads this file instead.

```bash
cp CLAUDE.md GEMINI.md
```

- [ ] **Step 10: Create `gemini-extension.json`**

Read version from package.json: `node -p "require('./package.json').version"`

```json
{
  "name": "local-rag",
  "description": "Persistent semantic memory and code intelligence for Gemini CLI",
  "version": "1.7.4",
  "contextFileName": "GEMINI.md"
}
```

- [ ] **Step 11: Commit**

```bash
git add .claude-plugin/ .mcp.json hooks/ CLAUDE.md GEMINI.md gemini-extension.json
git commit -m "feat: add Claude Code plugin and Gemini extension files"
```

---

### Task 9: Deprecate `local-rag init`

**Files:**
- Modify: `src/init.ts`

- [ ] **Step 1: Add deprecation notice to `init()`**

At the top of the `init()` function, before any other logic, add:
```typescript
process.stderr.write(
  `[init] DEPRECATED: local-rag init is no longer needed.\n` +
  `[init] Install the plugin instead:\n` +
  `[init]   claude plugin install @13w/local-rag\n` +
  `[init] For Gemini CLI:\n` +
  `[init]   gemini extensions install https://github.com/13w/local-rag\n` +
  `[init] See README for migration steps from v1.\n`
);
```

Keep the existing code below it (it still works for users who haven't migrated).

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | grep -v "dashboard-ui\|node_modules"
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/init.ts
git commit -m "feat: deprecate local-rag init in favour of plugin install"
```

---

## Self-Review

**Spec coverage:**
- ✅ Plugin structure: `.claude-plugin/`, `.mcp.json`, `hooks/`, `CLAUDE.md`, `GEMINI.md`, `gemini-extension.json` — Task 8
- ✅ `project_dir` in `.mcp.json` with `${CLAUDE_PROJECT_DIR}` — Task 8 Step 2
- ✅ Hook scripts use `CLAUDE_PROJECT_DIR` — Task 8 Steps 4–7
- ✅ Remove `agent_id` from `ProjectConfig` — Task 2
- ✅ Remove `agentId` from request-context — Task 1
- ✅ Remove `agentId` from session-store — Task 1
- ✅ Remove `agentId` from all plugins — Task 4
- ✅ Remove `agentId` from dashboard UI — Task 5
- ✅ Rename `project_root` → `project_dir` — Tasks 2, 6, 7
- ✅ `findProjectByDir()` in server-config — Task 7
- ✅ MCP resolves `project_dir` to `project_id` — Task 7
- ✅ Hook endpoints resolve `project_dir` — Task 4 + Task 7
- ✅ SessionStart auto-registers project — Task 3 + Task 8
- ✅ `init` deprecation — Task 9

**Open questions from spec (implement-time verification):**
- `${CLAUDE_PROJECT_DIR}` URL-encoding: in Task 7 Step 4, the server should `decodeURIComponent` the `project_dir` query param before lookup.
- `CLAUDE_PROJECT_DIR` availability in hook env: if not set, hook scripts fall back to `process.cwd()`.
