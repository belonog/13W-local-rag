# HTTP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stdio MCP transport with Streamable HTTP, move hook logic into HTTP endpoints, migrate all config from `.memory.json` to Qdrant, and make the server a standalone service.

**Architecture:** Single Fastify server on `127.0.0.1:7531` with three plugin groups (`/mcp`, `/hooks/*`, dashboard). Config split into a local bootstrap file (`~/.config/local-rag/config.json`) for the Qdrant URL, a Qdrant `server_config` collection for global settings (LLM, embed), and a `projects` collection for per-project settings. Per-request `projectId`/`agentId` injected via AsyncLocalStorage from MCP query params.

**Tech Stack:** Node.js 20+, TypeScript, Fastify 5, `@modelcontextprotocol/sdk@^1.29.0`, Qdrant, vitest (new), `node:readline` (interactive bootstrap prompt).

**Spec:** `docs/superpowers/specs/2026-04-06-http-foundation-design.md`

---

## File Map

```
CREATE  src/local-config.ts           bootstrap: ~/.config/local-rag/config.json
CREATE  src/server-config.ts          Qdrant server_config + projects CRUD
CREATE  src/request-context.ts        AsyncLocalStorage for per-request projectId/agentId
CREATE  src/http-server.ts            unified Fastify entry point
CREATE  src/plugins/mcp.ts            MCP Streamable HTTP plugin
CREATE  src/plugins/hooks.ts          hook endpoints + Qdrant hook_calls persistence
CREATE  src/plugins/dashboard.ts      dashboard plugin (moved from src/dashboard.ts)

MODIFY  src/qdrant.ts                 initQdrant(url, apiKey?) factory + export let qd
MODIFY  src/config.ts                 async loader from Qdrant (replaces .memory.json)
MODIFY  src/bin.ts                    serve → http-server.ts; bootstrap flow
MODIFY  src/hook-recall.ts            thin fetch client (~20 lines)
MODIFY  src/hook-remember.ts          thin fetch client (~20 lines)
MODIFY  src/init.ts                   interactive project setup via HTTP
MODIFY  src/dashboard-ui/src/types.ts extend RequestEntry with hook fields
MODIFY  src/dashboard-ui/src/app/     Settings tab component

DELETE  src/server.ts                 replaced by plugins/mcp.ts
DELETE  src/dashboard.ts              replaced by plugins/dashboard.ts
```

---

## Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Install vitest**

```bash
pnpm add -D vitest @vitest/coverage-v8
```

- [ ] **Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
```

- [ ] **Add test script to `package.json`**

Add inside `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Verify vitest works**

```bash
pnpm test
```
Expected: "No test files found" (or passes with 0 tests).

- [ ] **Commit**

```bash
git add package.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: `src/local-config.ts` — bootstrap file

**Files:**
- Create: `src/local-config.ts`
- Create: `src/local-config.test.ts`

- [ ] **Write failing test**

```typescript
// src/local-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "local-rag-test-")); });
afterEach(async () => { await rm(tmpDir, { recursive: true }); });

describe("local-config", () => {
  it("returns defaults when file does not exist", async () => {
    const { readLocalConfig } = await import("./local-config.js");
    const cfg = await readLocalConfig(join(tmpDir, "config.json"));
    expect(cfg.qdrant.url).toBe("http://localhost:6333");
    expect(cfg.port).toBe(7531);
  });

  it("round-trips write/read", async () => {
    const { readLocalConfig, writeLocalConfig } = await import("./local-config.js");
    const path = join(tmpDir, "config.json");
    await writeLocalConfig(path, {
      qdrant: { url: "http://myqdrant:6333", api_key: "tok", tls: false, prefix: "" },
      port: 8080,
    });
    const cfg = await readLocalConfig(path);
    expect(cfg.qdrant.url).toBe("http://myqdrant:6333");
    expect(cfg.port).toBe(8080);
  });
});
```

- [ ] **Run test — verify it fails**

```bash
pnpm test src/local-config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Create `src/local-config.ts`**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface QdrantConnectionConfig {
  url:     string;
  api_key: string;
  tls:     boolean;
  prefix:  string;
}

export interface LocalConfig {
  qdrant: QdrantConnectionConfig;
  port:   number;
}

const DEFAULTS: LocalConfig = {
  qdrant: { url: "http://localhost:6333", api_key: "", tls: false, prefix: "" },
  port:   7531,
};

export function defaultLocalConfigPath(): string {
  return join(homedir(), ".config", "local-rag", "config.json");
}

export async function readLocalConfig(path = defaultLocalConfigPath()): Promise<LocalConfig> {
  if (!existsSync(path)) return structuredClone(DEFAULTS);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;
    return {
      qdrant: { ...DEFAULTS.qdrant, ...(parsed.qdrant ?? {}) },
      port:   parsed.port ?? DEFAULTS.port,
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function writeLocalConfig(path: string, config: LocalConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
}

export async function updateLocalConfigPort(port: number, path = defaultLocalConfigPath()): Promise<void> {
  const current = await readLocalConfig(path);
  await writeLocalConfig(path, { ...current, port });
}
```

- [ ] **Run test — verify it passes**

```bash
pnpm test src/local-config.test.ts
```
Expected: PASS (2 tests).

- [ ] **Commit**

```bash
git add src/local-config.ts src/local-config.test.ts
git commit -m "feat: add local-config bootstrap file reader/writer"
```

---

## Task 3: `src/server-config.ts` — Qdrant config collections

**Files:**
- Create: `src/server-config.ts`
- Create: `src/server-config.test.ts`

- [ ] **Write failing test (pure logic — no Qdrant)**

```typescript
// src/server-config.test.ts
import { describe, it, expect } from "vitest";
import { mergeServerConfig, mergeProjectConfig } from "./server-config.js";

describe("mergeServerConfig", () => {
  it("fills missing fields with defaults", () => {
    const cfg = mergeServerConfig({});
    expect(cfg.port).toBe(7531);
    expect(cfg.embed.provider).toBe("ollama");
    expect(cfg.llm.provider).toBe("ollama");
    expect(cfg.collection_prefix).toBe("");
  });

  it("overrides defaults with provided values", () => {
    const cfg = mergeServerConfig({ port: 9000, collection_prefix: "test" });
    expect(cfg.port).toBe(9000);
    expect(cfg.collection_prefix).toBe("test");
  });
});

describe("mergeProjectConfig", () => {
  it("returns default project with provided project_id", () => {
    const p = mergeProjectConfig({ project_id: "myproj" });
    expect(p.project_id).toBe("myproj");
    expect(p.indexer_state).toBe("stopped");
    expect(p.include_paths).toEqual([]);
  });
});
```

- [ ] **Run test — verify it fails**

```bash
pnpm test src/server-config.test.ts
```

- [ ] **Create `src/server-config.ts`**

```typescript
import type { QdrantClient } from "@qdrant/js-client-rest";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LlmProviderConfig {
  provider: "ollama" | "anthropic" | "openai" | "gemini";
  model:    string;
  api_key:  string;
  url:      string;
  fallback: LlmProviderConfig | null;
}

export interface EmbedConfig {
  provider: "ollama" | "openai" | "voyage";
  model:    string;
  api_key:  string;
  dim:      number;
  url:      string;
}

export interface ServerConfig {
  embed:             EmbedConfig;
  llm:               LlmProviderConfig;
  router:            LlmProviderConfig;
  collection_prefix: string;
  port:              number;
  updated_at:        string;
}

export type IndexerState = "running" | "paused" | "stopped";

export interface ProjectConfig {
  project_id:     string;
  display_name:   string;
  agent_id:       string;
  project_root:   string;
  include_paths:  string[];
  indexer_state:  IndexerState;
  created_at:     string;
  updated_at:     string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_LLM: LlmProviderConfig = {
  provider: "ollama", model: "gemma3n:e2b", api_key: "", url: "", fallback: null,
};

const DEFAULT_EMBED: EmbedConfig = {
  provider: "ollama", model: "embeddinggemma:300m", api_key: "", dim: 768, url: "",
};

export function mergeServerConfig(raw: Partial<ServerConfig>): ServerConfig {
  return {
    embed:             { ...DEFAULT_EMBED,  ...(raw.embed  ?? {}) },
    llm:               { ...DEFAULT_LLM,   ...(raw.llm    ?? {}) },
    router:            { ...DEFAULT_LLM,   ...(raw.router ?? {}) },
    collection_prefix: raw.collection_prefix ?? "",
    port:              raw.port ?? 7531,
    updated_at:        raw.updated_at ?? new Date().toISOString(),
  };
}

export function mergeProjectConfig(raw: Partial<ProjectConfig> & { project_id: string }): ProjectConfig {
  const now = new Date().toISOString();
  return {
    project_id:    raw.project_id,
    display_name:  raw.display_name  ?? raw.project_id,
    agent_id:      raw.agent_id      ?? raw.project_id,
    project_root:  raw.project_root  ?? "",
    include_paths: raw.include_paths ?? [],
    indexer_state: raw.indexer_state ?? "stopped",
    created_at:    raw.created_at    ?? now,
    updated_at:    raw.updated_at    ?? now,
  };
}

// ── Qdrant CRUD ───────────────────────────────────────────────────────────────

const SERVER_CONFIG_COL = "server_config";
const PROJECTS_COL      = "projects";
const SERVER_CONFIG_ID  = 1; // single document

export async function ensureConfigCollections(qd: QdrantClient): Promise<void> {
  const cols = await qd.getCollections().then(r => new Set(r.collections.map(c => c.name)));

  if (!cols.has(SERVER_CONFIG_COL)) {
    await qd.createCollection(SERVER_CONFIG_COL, { vectors: { size: 1, distance: "Cosine" } });
    // no real vectors needed — store empty vector
  }
  if (!cols.has(PROJECTS_COL)) {
    await qd.createCollection(PROJECTS_COL, { vectors: { size: 1, distance: "Cosine" } });
  }
}

export async function loadServerConfig(qd: QdrantClient): Promise<ServerConfig> {
  const result = await qd.retrieve(SERVER_CONFIG_COL, {
    ids: [SERVER_CONFIG_ID], with_payload: true, with_vector: false,
  }).catch(() => []);
  const raw = (result[0]?.payload ?? {}) as Partial<ServerConfig>;
  return mergeServerConfig(raw);
}

export async function saveServerConfig(qd: QdrantClient, cfg: ServerConfig): Promise<void> {
  await qd.upsert(SERVER_CONFIG_COL, {
    wait: true,
    points: [{ id: SERVER_CONFIG_ID, vector: [0], payload: { ...cfg, updated_at: new Date().toISOString() } }],
  });
}

export async function loadProjectConfig(qd: QdrantClient, projectId: string): Promise<ProjectConfig | null> {
  const result = await qd.scroll(PROJECTS_COL, {
    filter: { must: [{ key: "project_id", match: { value: projectId } }] },
    limit: 1, with_payload: true, with_vector: false,
  }).catch(() => ({ points: [] }));
  const pt = result.points[0];
  if (!pt) return null;
  return mergeProjectConfig({ ...(pt.payload as Partial<ProjectConfig>), project_id: projectId });
}

export async function upsertProjectConfig(qd: QdrantClient, proj: ProjectConfig): Promise<void> {
  // Use stable numeric ID derived from project_id string hash
  const id = Math.abs(proj.project_id.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) || 1;
  await qd.upsert(PROJECTS_COL, {
    wait: true,
    points: [{ id, vector: [0], payload: { ...proj, updated_at: new Date().toISOString() } }],
  });
}

export async function listProjectConfigs(qd: QdrantClient): Promise<ProjectConfig[]> {
  const result = await qd.scroll(PROJECTS_COL, {
    limit: 100, with_payload: true, with_vector: false,
  }).catch(() => ({ points: [] }));
  return result.points.map(pt => mergeProjectConfig({
    ...(pt.payload as Partial<ProjectConfig>),
    project_id: String((pt.payload as Record<string, unknown>)["project_id"] ?? ""),
  }));
}
```

- [ ] **Run test — verify it passes**

```bash
pnpm test src/server-config.test.ts
```

- [ ] **Commit**

```bash
git add src/server-config.ts src/server-config.test.ts
git commit -m "feat: add server-config Qdrant collections (ServerConfig, ProjectConfig)"
```

---

## Task 4: `src/request-context.ts` — per-request context

**Files:**
- Create: `src/request-context.ts`

- [ ] **Create `src/request-context.ts`**

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestCtx {
  projectId: string;
  agentId:   string;
}

export const requestContext = new AsyncLocalStorage<RequestCtx>();

/** Returns the current request context, falling back to config defaults. */
export function getRequestCtx(fallbackProjectId: string, fallbackAgentId: string): RequestCtx {
  return requestContext.getStore() ?? { projectId: fallbackProjectId, agentId: fallbackAgentId };
}
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```
Expected: no errors for the new file.

- [ ] **Commit**

```bash
git add src/request-context.ts
git commit -m "feat: add AsyncLocalStorage request context for per-request projectId/agentId"
```

---

## Task 5: Refactor `src/qdrant.ts` — lazy initialization

**Files:**
- Modify: `src/qdrant.ts`

Currently `qdrant.ts` creates `qd` at module load using `cfg.qdrantUrl`. We need to decouple this so the server can init Qdrant after reading the local config.

- [ ] **Read current `src/qdrant.ts` top section**

Lines 1–5 currently:
```typescript
import { QdrantClient } from "@qdrant/js-client-rest";
import { cfg } from "./config.js";

export const qd = new QdrantClient({ url: cfg.qdrantUrl, timeout: 30_000 });
```

- [ ] **Replace top of `src/qdrant.ts` — make qd a mutable export**

Replace lines 1–4 with:
```typescript
import { QdrantClient } from "@qdrant/js-client-rest";

// Initialized lazily via initQdrant() — do not use before server bootstrap.
export let qd: QdrantClient = null as unknown as QdrantClient;

export function initQdrant(url: string, apiKey?: string): void {
  qd = new QdrantClient({ url, apiKey: apiKey || undefined, timeout: 30_000 });
}
```

Also remove the `import { cfg }` line since `cfg` is no longer needed here at module level.

- [ ] **Update `colName` to not use `cfg` at module load**

`colName` currently uses `cfg.collectionPrefix`. Change it to accept a prefix parameter with a getter:

```typescript
// Add after initQdrant:
let _collectionPrefix = "";
export function setCollectionPrefix(prefix: string): void { _collectionPrefix = prefix; }

export function colName(base: string): string {
  return _collectionPrefix ? `${_collectionPrefix}_${base}` : base;
}
```

Remove the old `cfg` import at the top of qdrant.ts (no longer needed here).

- [ ] **Verify TypeScript compiles (expect errors in server.ts — will fix later)**

```bash
pnpm exec tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add src/qdrant.ts
git commit -m "refactor: make Qdrant client lazy-initialized via initQdrant()"
```

---

## Task 6: Rewrite `src/config.ts` — async, loads from Qdrant

**Files:**
- Modify: `src/config.ts`

The new `config.ts` exposes a mutable `cfg` object populated after Qdrant connects. It also provides `initConfig()` to load from Qdrant, and `refreshConfig()` to reload after settings change.

- [ ] **Rewrite `src/config.ts`**

```typescript
import type { ServerConfig, ProjectConfig } from "./server-config.js";
import { getRequestCtx } from "./request-context.js";

// ── RouterProviderSpec re-exported for backward compat ────────────────────────

export interface RouterProviderSpec {
  provider:  "ollama" | "anthropic" | "openai" | "gemini";
  model:     string;
  api_key?:  string;
  url?:      string;
  fallback?: RouterProviderSpec | null;
}

// ── Mutable runtime config ────────────────────────────────────────────────────
// Populated by initConfig() at server startup. Read-only after that.

interface RuntimeConfig {
  // Embed
  embedProvider:  "ollama" | "openai" | "voyage";
  embedModel:     string;
  embedApiKey:    string;
  embedDim:       number;
  embedUrl:       string;
  // LLM
  llmProvider:    "ollama" | "anthropic" | "openai" | "gemini";
  llmModel:       string;
  llmApiKey:      string;
  llmUrl:         string;
  ollamaUrl:      string;
  // Router
  routerConfig:   RouterProviderSpec | null;
  // Server
  collectionPrefix: string;
  port:           number;
  // Defaults (overridden per-request via requestContext)
  projectId:      string;
  agentId:        string;
  // Legacy compat
  debugLogPath:   string;
  watch:          boolean;
  generateDescriptions: boolean;
}

const _cfg: RuntimeConfig = {
  embedProvider:        "ollama",
  embedModel:           "embeddinggemma:300m",
  embedApiKey:          "",
  embedDim:             768,
  embedUrl:             "",
  llmProvider:          "ollama",
  llmModel:             "gemma3n:e2b",
  llmApiKey:            "",
  llmUrl:               "",
  ollamaUrl:            "http://localhost:11434",
  routerConfig:         null,
  collectionPrefix:     "",
  port:                 7531,
  projectId:            "default",
  agentId:              "default",
  debugLogPath:         process.env["MEMORY_DEBUG_LOG"] ?? "",
  watch:                false,
  generateDescriptions: true,
};

export const cfg = _cfg;

export function applyServerConfig(sc: ServerConfig): void {
  _cfg.embedProvider        = sc.embed.provider as RuntimeConfig["embedProvider"];
  _cfg.embedModel           = sc.embed.model;
  _cfg.embedApiKey          = sc.embed.api_key;
  _cfg.embedDim             = sc.embed.dim;
  _cfg.embedUrl             = sc.embed.url;
  _cfg.llmProvider          = sc.llm.provider as RuntimeConfig["llmProvider"];
  _cfg.llmModel             = sc.llm.model;
  _cfg.llmApiKey            = sc.llm.api_key;
  _cfg.llmUrl               = sc.llm.url;
  _cfg.routerConfig         = sc.router as RouterProviderSpec;
  _cfg.collectionPrefix     = sc.collection_prefix;
  _cfg.port                 = sc.port;
  // set Qdrant collection prefix
  import("./qdrant.js").then(({ setCollectionPrefix }) => setCollectionPrefix(sc.collection_prefix));
}

/** Per-request project/agent — falls back to defaults. */
export function getProjectId(): string {
  return requestContext.getStore()?.projectId ?? _cfg.projectId;
}
export function getAgentId(): string {
  return requestContext.getStore()?.agentId ?? _cfg.agentId;
}

// Re-export for tools that use cfg.projectId directly (backward compat shim)
// Tools that read cfg.projectId will need to be updated to call getProjectId().

/** Mutable current branch — updated by the watcher on branch switch. */
let _currentBranch = "default";
export function setCurrentBranch(branch: string): void { _currentBranch = branch; }
export function getCurrentBranchCached(): string { return _currentBranch; }
```

Note: add missing import at the top:
```typescript
import { requestContext } from "./request-context.js";
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit 2>&1 | head -50
```

Fix any obvious type errors. Many tools that call `cfg.projectId` will now need to call `getProjectId()` — that will be fixed in Task 7.

- [ ] **Commit**

```bash
git add src/config.ts
git commit -m "refactor: config.ts loads from Qdrant via applyServerConfig(), uses AsyncLocalStorage for projectId"
```

---

## Task 7: Update tools to use `getProjectId()` / `getAgentId()`

**Files:**
- Modify: `src/tools/remember.ts`, `src/tools/recall.ts`, `src/tools/forget.ts`, `src/tools/consolidate.ts`, `src/tools/stats.ts`, `src/tools/search_code.ts`, `src/tools/get_file_context.ts`, `src/tools/get_dependencies.ts`, `src/tools/project_overview.ts`

- [ ] **Find all tools that use `cfg.projectId` or `cfg.agentId`**

```bash
grep -rn "cfg\.projectId\|cfg\.agentId" src/tools/
```

- [ ] **For each tool file found, replace `cfg.projectId` → `getProjectId()` and `cfg.agentId` → `getAgentId()`**

Pattern to apply in each affected file:

Add import at top:
```typescript
import { getProjectId, getAgentId } from "../config.js";
```

Replace all occurrences:
```typescript
// before:
cfg.projectId
// after:
getProjectId()

// before:
cfg.agentId
// after:
getAgentId()
```

Do not import `cfg` if it's only used for projectId/agentId. If `cfg` is still needed for other fields (embedModel, llmModel, etc.), keep the import.

- [ ] **Verify TypeScript compiles cleanly**

```bash
pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Commit**

```bash
git add src/tools/
git commit -m "refactor: tools use getProjectId()/getAgentId() for per-request context"
```

---

## Task 8: Extract tool registry to `src/tools/registry.ts`

**Files:**
- Create: `src/tools/registry.ts`
- Modify: `src/server.ts` (import from registry)

The `TOOLS` array and `dispatchTool` function currently live in `server.ts`. The new MCP plugin needs them without importing `server.ts` (which bootstraps the whole stdio server).

- [ ] **Create `src/tools/registry.ts`**

Move the `TOOLS` array (lines 36–215 of server.ts), `TOOL_MAP`, and `dispatchTool` function (lines 218–414) into this file. Also move the argument helper functions (`str`, `num`, `int`, `bool`):

```typescript
// src/tools/registry.ts
// Tool definitions and dispatch — shared between MCP HTTP and dashboard playground.

import { rememberTool }         from "./remember.js";
import { recallTool }           from "./recall.js";
import { searchCodeTool }       from "./search_code.js";
import { forgetTool }           from "./forget.js";
import { consolidateTool }      from "./consolidate.js";
import { statsTool }            from "./stats.js";
import { getFileContextTool }   from "./get_file_context.js";
import { getDependenciesTool }  from "./get_dependencies.js";
import { projectOverviewTool }  from "./project_overview.js";
import { getSymbolTool }        from "./get_symbol.js";
import { findUsagesTool }       from "./find_usages.js";
import { requestValidationTool } from "./request-validation.js";
import type { Status }           from "../types.js";

// [Paste the full TOOLS array from server.ts lines 36-215 here]
export const TOOLS = [ /* ... all 14 tool definitions ... */ ];

export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

function str(v: unknown, def = ""): string    { return typeof v === "string"  ? v : def; }
function num(v: unknown, def: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return def;
}
function int(v: unknown, def: number): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string" && v !== "") { const n = Number(v); if (!Number.isNaN(n)) return Math.trunc(n); }
  return def;
}
function bool(v: unknown, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return def;
}

// [Paste the full dispatchTool function from server.ts lines 326-414 here]
export async function dispatchTool(name: string, a: Record<string, unknown>): Promise<string> {
  // ... full implementation from server.ts ...
}
```

- [ ] **Update `src/server.ts` to import from registry**

Replace the `TOOLS`, `TOOL_MAP`, `dispatchTool`, and helper function definitions in server.ts with imports:

```typescript
import { TOOLS, TOOL_MAP, dispatchTool } from "./tools/registry.js";
```

Remove the now-duplicate code from server.ts.

- [ ] **Verify TypeScript compiles + server still works**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/tools/registry.ts src/server.ts
git commit -m "refactor: extract TOOLS + dispatchTool to src/tools/registry.ts"
```

---

## Task 9: Bootstrap flow — `src/bootstrap.ts`

**Files:**
- Create: `src/bootstrap.ts`

The serve command needs interactive Qdrant URL setup on first run.

- [ ] **Create `src/bootstrap.ts`**

```typescript
import { createInterface } from "node:readline/promises";
import { stdin, stdout }   from "node:process";
import { QdrantClient }    from "@qdrant/js-client-rest";
import {
  readLocalConfig, writeLocalConfig, defaultLocalConfigPath,
  type LocalConfig,
} from "./local-config.js";
import { initQdrant } from "./qdrant.js";

async function promptQdrantConfig(): Promise<LocalConfig["qdrant"]> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const url     = (await rl.question("Qdrant URL [http://localhost:6333]: ")).trim() || "http://localhost:6333";
    const api_key = (await rl.question("Qdrant API key (leave empty if none): ")).trim();
    const tlsStr  = (await rl.question("Use TLS? [y/N]: ")).trim().toLowerCase();
    return { url, api_key, tls: tlsStr === "y", prefix: "" };
  } finally {
    rl.close();
  }
}

async function tryConnect(url: string, apiKey?: string): Promise<boolean> {
  try {
    const client = new QdrantClient({ url, apiKey: apiKey || undefined, timeout: 5_000 });
    await client.getCollections();
    return true;
  } catch {
    return false;
  }
}

export async function bootstrap(): Promise<void> {
  const configPath = defaultLocalConfigPath();
  let localCfg = await readLocalConfig(configPath);

  // Try existing config first
  if (await tryConnect(localCfg.qdrant.url, localCfg.qdrant.api_key)) {
    initQdrant(localCfg.qdrant.url, localCfg.qdrant.api_key);
    process.stderr.write(`[bootstrap] Connected to Qdrant at ${localCfg.qdrant.url}\n`);
    return;
  }

  // Try localhost default
  if (localCfg.qdrant.url !== "http://localhost:6333") {
    if (await tryConnect("http://localhost:6333")) {
      localCfg.qdrant.url = "http://localhost:6333";
      localCfg.qdrant.api_key = "";
      await writeLocalConfig(configPath, localCfg);
      initQdrant("http://localhost:6333");
      process.stderr.write(`[bootstrap] Connected to Qdrant at http://localhost:6333\n`);
      return;
    }
  }

  // Prompt user
  process.stderr.write("[bootstrap] Cannot connect to Qdrant. Please provide connection details.\n");
  const qdrantCfg = await promptQdrantConfig();

  if (!await tryConnect(qdrantCfg.url, qdrantCfg.api_key)) {
    process.stderr.write(`[bootstrap] ERROR: Cannot connect to ${qdrantCfg.url}. Exiting.\n`);
    process.exit(1);
  }

  localCfg.qdrant = qdrantCfg;
  await writeLocalConfig(configPath, localCfg);
  initQdrant(qdrantCfg.url, qdrantCfg.api_key);
  process.stderr.write(`[bootstrap] Connected and saved config to ${configPath}\n`);
}
```

- [ ] **Commit**

```bash
git add src/bootstrap.ts
git commit -m "feat: add bootstrap.ts — interactive Qdrant setup on first run"
```

---

## Task 10: Extend `RequestEntry` with hook fields

**Files:**
- Modify: `src/dashboard-ui/src/types.ts`

- [ ] **Update `RequestEntry` in `src/dashboard-ui/src/types.ts`**

Replace the existing `RequestEntry` interface with:

```typescript
export interface RequestEntry {
  ts:        number;
  tool:      string;
  source:    "mcp" | "playground" | "watcher" | "hook";
  bytesIn:   number;
  bytesOut:  number;
  ms:        number;
  ok:        boolean;
  chunks?:   number;
  error?:    string;
  // hook-only
  hook_type?:  "recall" | "remember";
  session_id?: string;
  project_id?: string;
  agent_id?:   string;
  found?:      number;
  summary?:    string;
  written?:    number;
  validated?:  number;
  discarded?:  number;
  facts?:      string[];
}
```

- [ ] **Build the UI to verify no TypeScript errors**

```bash
pnpm -C src/dashboard-ui run build 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src/dashboard-ui/src/types.ts
git commit -m "feat: extend RequestEntry with hook fields (source: hook, recall/remember metadata)"
```

---

## Task 11: `src/plugins/dashboard.ts` — move dashboard to plugin

**Files:**
- Create: `src/plugins/dashboard.ts`

Move the Fastify routes and state from `src/dashboard.ts` into a Fastify plugin function. The module-level state stays. The only change is wrapping routes in `async function dashboardPlugin(fastify)`.

- [ ] **Create `src/plugins/dashboard.ts`**

```typescript
import type { FastifyInstance } from "fastify";
// Copy all imports from src/dashboard.ts

// Copy all module-level state (toolStats, requestLog, sseClients, etc.)

// Copy all helper functions (memStats, statsSnapshot, etc.)

// Export all currently-exported functions (record, recordIndex, broadcastShutdown, etc.)

// New: wrap Fastify routes in a plugin
export async function dashboardPlugin(fastify: FastifyInstance): Promise<void> {
  // Copy all fastify.get/post route registrations from src/dashboard.ts
  // fastify.register(fastifyStatic, ...) goes here too
}

// Keep startDashboard export stub for backward compat during transition
// (will be removed when src/server.ts is deleted)
export function startDashboard(...): void { /* kept temporarily */ }
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/plugins/dashboard.ts
git commit -m "refactor: move dashboard to src/plugins/dashboard.ts as Fastify plugin"
```

---

## Task 12: `src/plugins/mcp.ts` — MCP Streamable HTTP plugin

**Files:**
- Create: `src/plugins/mcp.ts`

- [ ] **Create `src/plugins/mcp.ts`**

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Server }                         from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport }  from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError }
  from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, TOOL_MAP, dispatchTool }  from "../tools/registry.js";
import { requestContext }                 from "../request-context.js";
import { record }                         from "./dashboard.js";
import { debugLog }                       from "../util.js";

function buildMcpServer(): Server {
  const server = new Server(
    { name: "local-rag", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
  );

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
  const mcpServer = buildMcpServer();
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
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/plugins/mcp.ts
git commit -m "feat: add MCP Streamable HTTP plugin at /mcp"
```

---

## Task 13: `src/plugins/hooks.ts` — hook endpoints

**Files:**
- Create: `src/plugins/hooks.ts`

- [ ] **Create `src/plugins/hooks.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { randomUUID }   from "node:crypto";
import { runArchivist } from "../archivist.js";
import { runRouter }    from "../router.js";
import { storeMemory, buildValidationRequests, buildWindow,
         safeParseLines, buildTranscriptContext }  from "../util.js";
import { record }        from "./dashboard.js";
import { qd, colName }   from "../qdrant.js";
import { cfg }           from "../config.js";
import { debugLog }      from "../util.js";
import type { RequestEntry } from "../dashboard-ui/src/types.js";

// Re-use hook logic from existing hook-remember.ts / hook-recall.ts
// This plugin is the server-side implementation; the subprocess clients
// (src/hook-recall.ts, src/hook-remember.ts) just POST here.

interface HookBody {
  session_id:       string;
  transcript_path:  string;
  cwd:              string;
  hook_event_name?: string;
  prompt?:          string;
  stop_hook_active?: boolean;
}

async function persistHookCall(entry: RequestEntry & { project_id: string }): Promise<void> {
  const col       = colName("hook_calls");
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  try {
    await qd.upsert(col, {
      wait: false,
      points: [{
        id:      randomUUID(),
        vector:  [0],
        payload: { ...entry, expires_at: expiresAt },
      }],
    });
  } catch (err) {
    debugLog("hooks", `persistHookCall failed: ${String(err)}`);
  }
}

export async function hooksPlugin(fastify: FastifyInstance): Promise<void> {

  fastify.post<{ Body: HookBody }>("/hooks/recall", async (req, reply) => {
    const t0   = Date.now();
    const body = req.body;
    const bytesIn = JSON.stringify(body).length;

    let systemMessage = "";
    let found = 0;
    let summary = "";
    let ok = true;

    try {
      const context = await buildTranscriptContext(body.transcript_path, 2000);
      const result  = await runArchivist(`${context}\n\nUser prompt: ${body.prompt ?? ""}`);
      systemMessage = result.systemMessage ?? "";
      found         = result.found         ?? 0;
      summary       = result.summary       ?? "";
    } catch (err) {
      ok = false;
      debugLog("hooks", `recall error: ${String(err)}`);
    }

    const ms    = Date.now() - t0;
    const entry: RequestEntry & { project_id: string } = {
      ts: Date.now(), tool: "recall", source: "hook",
      hook_type: "recall", session_id: body.session_id,
      project_id: cfg.projectId,
      bytesIn, bytesOut: systemMessage.length, ms, ok,
      found, summary: summary.slice(0, 200),
    };
    record("recall", "hook" as "mcp", bytesIn, systemMessage.length, ms, ok);
    void persistHookCall(entry);

    return reply.send({ systemMessage });
  });

  fastify.post<{ Body: HookBody }>("/hooks/remember", async (req, reply) => {
    const t0      = Date.now();
    const body    = req.body;
    const bytesIn = JSON.stringify(body).length;

    let systemMessage = "";
    let written = 0, validated = 0, discarded = 0;
    const facts: string[] = [];
    let ok = true;

    try {
      const lines  = await safeParseLines(body.transcript_path);
      const window = buildWindow(lines, 8000);
      const ops    = await runRouter(window);

      const DIRECT_THRESHOLD = body.stop_hook_active ? 0.75 : 0.85;
      const direct    = ops.filter(o => o.confidence >= DIRECT_THRESHOLD);
      const toValidate = ops.filter(o => o.confidence >= 0.5 && o.confidence < DIRECT_THRESHOLD);
      discarded        = ops.filter(o => o.confidence < 0.5).length;

      for (const op of direct) {
        await storeMemory({
          text: op.text, status: op.status, confidence: op.confidence,
          session_id: body.session_id, session_type: "editing",
          source: "hook-remember",
        });
        written++;
        if (facts.length < 5) facts.push(op.text.slice(0, 100));
      }

      if (toValidate.length > 0 && !body.stop_hook_active) {
        systemMessage = buildValidationRequests(toValidate);
        validated = toValidate.length;
      }
    } catch (err) {
      ok = false;
      debugLog("hooks", `remember error: ${String(err)}`);
    }

    const ms    = Date.now() - t0;
    const entry: RequestEntry & { project_id: string } = {
      ts: Date.now(), tool: "remember", source: "hook",
      hook_type: "remember", session_id: body.session_id,
      project_id: cfg.projectId,
      bytesIn, bytesOut: systemMessage.length, ms, ok,
      written, validated, discarded, facts,
    };
    record("remember", "hook" as "mcp", bytesIn, systemMessage.length, ms, ok);
    void persistHookCall(entry);

    return reply.send({ systemMessage });
  });
}
```

Note: `runArchivist` needs to return `{ systemMessage, found, summary }`. Check `src/archivist.ts` and update its return type if needed to expose `found` count.

- [ ] **Ensure `hook_calls` collection is created at startup**

In `src/qdrant.ts` `ensureCollections()`, add `hook_calls` to the collection list. Add a no-vector collection (payload-only):

```typescript
// In ensureCollections(), after existing collections:
const hookCallsCol = colName("hook_calls");
if (!existing.has(hookCallsCol)) {
  await qd.createCollection(hookCallsCol, { vectors: { size: 1, distance: "Cosine" } });
}
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/plugins/hooks.ts src/qdrant.ts
git commit -m "feat: add hook endpoints POST /hooks/recall and /hooks/remember with Qdrant persistence"
```

---

## Task 14: `src/http-server.ts` — unified server entry

**Files:**
- Create: `src/http-server.ts`

- [ ] **Create `src/http-server.ts`**

```typescript
import Fastify          from "fastify";
import fastifyStatic    from "@fastify/static";
import { resolve }      from "node:path";
import { dirname }      from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap }    from "./bootstrap.js";
import { loadServerConfig, ensureConfigCollections } from "./server-config.js";
import { applyServerConfig } from "./config.js";
import { ensureCollections } from "./qdrant.js";
import { updateLocalConfigPort } from "./local-config.js";
import { mcpPlugin }     from "./plugins/mcp.js";
import { hooksPlugin }   from "./plugins/hooks.js";
import { dashboardPlugin, broadcastShutdown, broadcastError } from "./plugins/dashboard.js";
import { buildProjectProfile } from "./archivist.js";
import { isGitRepo, getCurrentBranch } from "./indexer/git.js";
import { cfg, setCurrentBranch } from "./config.js";

const _dir = dirname(fileURLToPath(import.meta.url));

export async function startHttpServer(): Promise<void> {
  // 1. Connect to Qdrant (interactive if needed)
  await bootstrap();

  // 2. Ensure all collections exist (qd is initialized by bootstrap())
  const { qd } = await import("./qdrant.js");
  await ensureCollections();
  await ensureConfigCollections(qd);

  // 3. Load server config from Qdrant
  const serverCfg = await loadServerConfig(qd);
  applyServerConfig(serverCfg);

  // 4. Build Fastify
  const fastify = Fastify({ logger: false });

  // Static files for dashboard UI
  const uiDir = resolve(_dir, "dashboard-ui");
  await fastify.register(fastifyStatic, { root: uiDir, index: false });

  // Register plugins
  await fastify.register(mcpPlugin);
  await fastify.register(hooksPlugin);
  await fastify.register(dashboardPlugin);

  // 5. Start server
  const port = cfg.port;
  await fastify.listen({ port, host: "127.0.0.1" });

  const addr       = fastify.server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  process.stderr.write(`[server] http://127.0.0.1:${actualPort}\n`);
  process.stderr.write(`[server] MCP: http://127.0.0.1:${actualPort}/mcp?project=<id>&agent=<id>\n`);

  // 6. Write actual port to local config (for hook subprocesses)
  await updateLocalConfigPort(actualPort);

  // 7. Git branch detection
  const root    = cfg.projectId !== "default" ? "" : process.cwd();
  if (root && isGitRepo(root)) {
    const branch = getCurrentBranch(root);
    setCurrentBranch(branch);
  }

  // 8. Build archivist project profile (non-blocking)
  buildProjectProfile().catch((err: unknown) => {
    process.stderr.write(`[archivist] profile build failed: ${String(err)}\n`);
  });

  // 9. Graceful shutdown
  process.on("SIGINT",  () => { broadcastShutdown(); process.exit(0); });
  process.on("SIGTERM", () => { broadcastShutdown(); process.exit(0); });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[server] uncaughtException: ${err.stack ?? err.message}\n`);
    broadcastError(err);
    setTimeout(() => process.exit(1), 250);
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    process.stderr.write(`[server] unhandledRejection: ${err.stack ?? err.message}\n`);
    broadcastError(err);
    setTimeout(() => process.exit(1), 250);
  });
}
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/http-server.ts
git commit -m "feat: add http-server.ts unified Fastify entry point"
```

---

## Task 15: Update `src/bin.ts` — wire serve to HTTP server

**Files:**
- Modify: `src/bin.ts`

- [ ] **Update serve command in `src/bin.ts`**

```typescript
#!/usr/bin/env node
const args = process.argv.slice(2).filter((a) => a !== "--");
const cmd  = args[0];

if (cmd === "serve" || cmd === "server") {
  const { startHttpServer } = await import("./http-server.js");
  await startHttpServer();
} else if (cmd === "init") {
  const { init } = await import("./init.js");
  init();
} else if (cmd === "migrate") {
  const { runMigrate } = await import("./migrate.js");
  await runMigrate();
} else if (cmd === "hook-recall") {
  const { runHookRecall } = await import("./hook-recall.js");
  await runHookRecall();
} else if (cmd === "hook-remember") {
  const { runHookRemember } = await import("./hook-remember.js");
  await runHookRemember();
} else {
  await import("./indexer/cli.js");
}
```

- [ ] **Build and smoke-test**

```bash
pnpm build 2>&1 | tail -5
node dist/bin.js serve
```
Expected: `[server] http://127.0.0.1:7531` in stderr. Ctrl-C to stop.

- [ ] **Commit**

```bash
git add src/bin.ts
git commit -m "feat: bin.ts serve command uses http-server.ts"
```

---

## Task 16: Simplify hook subprocesses — thin HTTP clients

**Files:**
- Modify: `src/hook-recall.ts`
- Modify: `src/hook-remember.ts`

- [ ] **Rewrite `src/hook-recall.ts`**

```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookRecall(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) { process.stdout.write("{}"); return; }

  const localCfg = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${serverUrl}/hooks/recall`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) { process.stdout.write("{}"); return; }
    const data = await res.text();
    process.stdout.write(data);
  } catch {
    process.stdout.write("{}");
  }
}
```

- [ ] **Rewrite `src/hook-remember.ts`**

```typescript
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookRemember(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) { process.stdout.write("{}"); return; }

  const localCfg = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${serverUrl}/hooks/remember`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) { process.stdout.write("{}"); return; }
    const data = await res.text();
    process.stdout.write(data);
  } catch {
    process.stdout.write("{}");
  }
}
```

- [ ] **Build and test hook subprocess**

```bash
pnpm build
echo '{"session_id":"test","transcript_path":"/tmp/nonexistent","cwd":"/tmp","prompt":"test"}' | node dist/bin.js hook-recall
```
Expected: `{}` (server not running → graceful empty response).

Start server and retry:
```bash
node dist/bin.js serve &
sleep 2
echo '{"session_id":"test","transcript_path":"/tmp/nonexistent","cwd":"/tmp","prompt":"test"}' | node dist/bin.js hook-recall
```
Expected: `{"systemMessage":""}` or similar JSON.

- [ ] **Commit**

```bash
git add src/hook-recall.ts src/hook-remember.ts
git commit -m "refactor: hook subprocesses become thin HTTP clients posting to /hooks/*"
```

---

## Task 17: End-to-end verification

- [ ] **Test MCP endpoint**

Start server, then:
```bash
curl -s -X POST 'http://127.0.0.1:7531/mcp?project=test&agent=claude' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```
Expected: JSON-RPC response with `result.capabilities.tools`.

- [ ] **Test project scoping**

```bash
curl -s -X POST 'http://127.0.0.1:7531/mcp?project=proj-a&agent=claude' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stats","arguments":{}}}'
```
Expected: stats response mentioning project-a.

- [ ] **Test hook recall via dashboard**

Open `http://127.0.0.1:7531` → request log tab → trigger hook → entry appears with `source: hook`.

- [ ] **Test Qdrant persistence**

After hook-remember fires, check Qdrant `hook_calls` collection has an entry with `expires_at` ~7 days from now.

- [ ] **Test graceful server-down hook**

Kill server. Run hook subprocess. Verify session continues without error (returns `{}`).

- [ ] **Configure Claude Code with new URL**

Update `~/.claude/settings.json` MCP entry:
```json
{ "url": "http://127.0.0.1:7531/mcp?project=local-rag&agent=claude" }
```
Open new Claude Code session → verify memory tools work.

---

## Task 18: Update `record()` to accept `source: "hook"`

**Files:**
- Modify: `src/dashboard.ts` → `src/plugins/dashboard.ts`

The `record()` function currently accepts `source: "mcp" | "playground"`. Hook calls pass `"hook"` as source.

- [ ] **Update `record()` signature in `src/plugins/dashboard.ts`**

```typescript
// Change:
export function record(tool: string, source: "mcp" | "playground", ...): void

// To:
export function record(tool: string, source: "mcp" | "playground" | "hook", ...): void
```

Also update the `RequestEntry` interface in `src/dashboard.ts` (backend copy) to match the frontend types:
```typescript
interface RequestEntry {
  ts: number; tool: string;
  source: "mcp" | "playground" | "watcher" | "hook";
  // ... rest unchanged
}
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/plugins/dashboard.ts
git commit -m "fix: record() accepts source: hook for hook call logging"
```

---

## Task 19: `local-rag init` redesign

**Files:**
- Modify: `src/init.ts`

- [ ] **Read current `src/init.ts`**

```bash
cat src/init.ts
```

- [ ] **Rewrite `src/init.ts`**

```typescript
import { createInterface }   from "node:readline/promises";
import { stdin, stdout }     from "node:process";
import { basename, resolve } from "node:path";
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";
import { mergeProjectConfig } from "./server-config.js";

async function prompt(rl: Awaited<ReturnType<typeof createInterface>>, question: string, def = ""): Promise<string> {
  const answer = (await rl.question(question)).trim();
  return answer || def;
}

export async function init(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // 1. Resolve server URL
    const localCfg  = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
    const port       = localCfg?.port ?? 7531;
    const serverUrl  = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

    // 2. Verify server is running
    const health = await fetch(`${serverUrl}/api/stats`).catch(() => null);
    if (!health?.ok) {
      process.stderr.write(`[init] ERROR: Server not running at ${serverUrl}. Run 'local-rag serve' first.\n`);
      process.exit(1);
    }

    // 3. Gather project info
    const defaultName = basename(resolve(process.cwd()));
    const projectId   = await prompt(rl, `Project name [${defaultName}]: `, defaultName);
    const agentId     = await prompt(rl, `Agent name [${projectId}]: `, projectId);

    // 4. Create project on server
    const proj = mergeProjectConfig({ project_id: projectId, agent_id: agentId, display_name: projectId });
    const res  = await fetch(`${serverUrl}/api/projects`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(proj),
    });
    if (!res.ok) {
      process.stderr.write(`[init] ERROR: Failed to create project: ${await res.text()}\n`);
      process.exit(1);
    }

    // 5. Configure hooks in .claude/settings.json
    await configureHooks(projectId, agentId, serverUrl);

    // 6. Print dashboard URL
    process.stderr.write(`\n[init] Project '${projectId}' created.\n`);
    process.stderr.write(`[init] Dashboard: ${serverUrl}/?project=${projectId}\n`);
    process.stderr.write(`[init] Open the dashboard to configure project root, include paths, and start indexing.\n`);
  } finally {
    rl.close();
  }
}

async function configureHooks(projectId: string, agentId: string, serverUrl: string): Promise<void> {
  // Write hook configuration to .claude/settings.json
  // (same logic as current init.ts — configure PreToolUse/PostToolUse hooks)
  const { writeFileSync, existsSync, readFileSync, mkdirSync } = await import("node:fs");
  const settingsPath = resolve(process.cwd(), ".claude", "settings.json");
  mkdirSync(resolve(process.cwd(), ".claude"), { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>; } catch {}
  }

  // Set MCP server URL with project/agent params
  const mcpUrl = `${serverUrl}/mcp?project=${projectId}&agent=${agentId}`;
  const mcpServers = (settings["mcpServers"] ?? {}) as Record<string, unknown>;
  mcpServers["memory"] = { url: mcpUrl };
  settings["mcpServers"] = mcpServers;

  // Configure hooks to use local-rag subprocesses
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  hooks["PreToolUse"]    = [{ matcher: ".*", hooks: [{ type: "command", command: "local-rag hook-recall" }] }];
  hooks["Stop"]          = [{ hooks: [{ type: "command", command: "local-rag hook-remember" }] }];
  settings["hooks"] = hooks;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  process.stderr.write(`[init] Configured .claude/settings.json (hooks + MCP at ${mcpUrl})\n`);
}
```

- [ ] **Add `POST /api/projects` endpoint to dashboard plugin**

In `src/plugins/dashboard.ts`, add after existing API routes:
```typescript
fastify.post<{ Body: ProjectConfig }>("/api/projects", async (req, reply) => {
  const { upsertProjectConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  await upsertProjectConfig(qd, req.body);
  return reply.code(201).send({ ok: true });
});

fastify.get("/api/projects", async (_req, reply) => {
  const { listProjectConfigs } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  const projects = await listProjectConfigs(qd);
  return reply.send({ projects });
});
```

- [ ] **Verify TypeScript compiles and test init flow**

```bash
pnpm build
# With server running:
local-rag init
```
Expected: prompts for project name → creates project → prints dashboard URL.

- [ ] **Commit**

```bash
git add src/init.ts src/plugins/dashboard.ts
git commit -m "feat: local-rag init creates project on server, configures hooks + MCP URL"
```

---

## Task 20: Dashboard Settings tab (Angular)

**Files:**
- Modify: `src/dashboard-ui/src/app/app.component.ts` (add Settings tab)
- Create: `src/dashboard-ui/src/app/components/settings.component.ts`
- Modify: `src/dashboard-ui/src/types.ts` (add config types)
- Modify: `src/plugins/dashboard.ts` (add config API endpoints)

- [ ] **Add config types to `src/dashboard-ui/src/types.ts`**

```typescript
export interface LlmProviderConfig {
  provider: string;
  model:    string;
  api_key:  string;
  url:      string;
  fallback: LlmProviderConfig | null;
}

export interface EmbedConfig {
  provider: string;
  model:    string;
  api_key:  string;
  dim:      number;
  url:      string;
}

export interface ServerConfigData {
  embed:             EmbedConfig;
  llm:               LlmProviderConfig;
  router:            LlmProviderConfig;
  collection_prefix: string;
  port:              number;
}

export interface ProjectConfigData {
  project_id:    string;
  display_name:  string;
  agent_id:      string;
  project_root:  string;
  include_paths: string[];
  indexer_state: "running" | "paused" | "stopped";
}
```

- [ ] **Add config API endpoints to `src/plugins/dashboard.ts`**

```typescript
// GET /api/config/server — return current server config
fastify.get("/api/config/server", async () => {
  const { loadServerConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  return loadServerConfig(qd);
});

// PUT /api/config/server — update server config
fastify.put<{ Body: Partial<ServerConfig> }>("/api/config/server", async (req, reply) => {
  const { loadServerConfig, saveServerConfig, mergeServerConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  const current = await loadServerConfig(qd);
  const updated = mergeServerConfig({ ...current, ...req.body });
  await saveServerConfig(qd, updated);
  applyServerConfig(updated); // take effect immediately
  return reply.send({ ok: true });
});

// GET /api/projects/:projectId
fastify.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async (req) => {
  const { loadProjectConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  return loadProjectConfig(qd, req.params.projectId);
});

// PUT /api/projects/:projectId
fastify.put<{ Params: { projectId: string }; Body: Partial<ProjectConfig> }>("/api/projects/:projectId", async (req, reply) => {
  const { loadProjectConfig, upsertProjectConfig, mergeProjectConfig } = await import("../server-config.js");
  const { qd } = await import("../qdrant.js");
  const current = await loadProjectConfig(qd, req.params.projectId) ?? mergeProjectConfig({ project_id: req.params.projectId });
  await upsertProjectConfig(qd, mergeProjectConfig({ ...current, ...req.body, project_id: req.params.projectId }));
  return reply.send({ ok: true });
});
```

- [ ] **Create `src/dashboard-ui/src/app/components/settings.component.ts`**

```typescript
import { Component, OnInit } from "@angular/core";
import { HttpClient }        from "@angular/common/http";
import { FormsModule }       from "@angular/forms";
import { CommonModule }      from "@angular/common";
import type { ServerConfigData, ProjectConfigData } from "../../types.js";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [FormsModule, CommonModule],
  template: `
    <div class="settings">
      <h2>Server Settings</h2>
      <div *ngIf="serverCfg">
        <h3>Embed</h3>
        <label>Provider <input [(ngModel)]="serverCfg.embed.provider" /></label>
        <label>Model    <input [(ngModel)]="serverCfg.embed.model"    /></label>
        <label>API Key  <input [(ngModel)]="serverCfg.embed.api_key" type="password" /></label>
        <label>Dim      <input [(ngModel)]="serverCfg.embed.dim"     type="number"  /></label>
        <h3>LLM</h3>
        <label>Provider <input [(ngModel)]="serverCfg.llm.provider" /></label>
        <label>Model    <input [(ngModel)]="serverCfg.llm.model"    /></label>
        <label>API Key  <input [(ngModel)]="serverCfg.llm.api_key" type="password" /></label>
        <h3>Router</h3>
        <label>Provider <input [(ngModel)]="serverCfg.router.provider" /></label>
        <label>Model    <input [(ngModel)]="serverCfg.router.model"    /></label>
        <label>API Key  <input [(ngModel)]="serverCfg.router.api_key" type="password" /></label>
        <h3>General</h3>
        <label>Collection prefix <input [(ngModel)]="serverCfg.collection_prefix" /></label>
        <label>Port (requires restart) <input [(ngModel)]="serverCfg.port" type="number" /></label>
        <button (click)="saveServer()">Save Server Settings</button>
      </div>

      <h2>Project Settings</h2>
      <div *ngIf="projectCfg">
        <label>Display name  <input [(ngModel)]="projectCfg.display_name"  /></label>
        <label>Agent name    <input [(ngModel)]="projectCfg.agent_id"       /></label>
        <label>Project root  <input [(ngModel)]="projectCfg.project_root"  /></label>
        <label>Include paths (comma-separated)
          <input [ngModel]="projectCfg.include_paths.join(',')"
                 (ngModelChange)="projectCfg.include_paths = $event.split(',').map((s: string) => s.trim()).filter(Boolean)" />
        </label>
        <h3>Indexer</h3>
        <button (click)="setIndexerState('running')">Start</button>
        <button (click)="setIndexerState('paused')">Pause</button>
        <button (click)="setIndexerState('stopped')">Stop</button>
        <span>Current: {{ projectCfg.indexer_state }}</span>
        <br>
        <button (click)="saveProject()">Save Project Settings</button>
      </div>

      <div *ngIf="saved" class="saved-msg">Saved ✓</div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  serverCfg:  ServerConfigData | null = null;
  projectCfg: ProjectConfigData | null = null;
  saved = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<ServerConfigData>("/api/config/server").subscribe(d => this.serverCfg = d);
    const projectId = new URLSearchParams(window.location.search).get("project") ?? "default";
    this.http.get<ProjectConfigData>(`/api/projects/${projectId}`).subscribe(d => this.projectCfg = d);
  }

  saveServer(): void {
    this.http.put("/api/config/server", this.serverCfg).subscribe(() => this.flash());
  }

  saveProject(): void {
    const projectId = this.projectCfg?.project_id ?? "default";
    this.http.put(`/api/projects/${projectId}`, this.projectCfg).subscribe(() => this.flash());
  }

  setIndexerState(state: "running" | "paused" | "stopped"): void {
    if (this.projectCfg) {
      this.projectCfg.indexer_state = state;
      this.saveProject();
    }
  }

  private flash(): void { this.saved = true; setTimeout(() => this.saved = false, 2000); }
}
```

- [ ] **Add Settings tab to `src/dashboard-ui/src/app/app.component.ts`**

Add `"settings"` to the tab list and import `SettingsComponent`:
```typescript
import { SettingsComponent } from "./components/settings.component.js";
// In template, add tab:
// <button (click)="tab='settings'">Settings</button>
// <app-settings *ngIf="tab==='settings'"></app-settings>
```

- [ ] **Build UI**

```bash
pnpm -C src/dashboard-ui run build
```
Expected: build succeeds.

- [ ] **Commit**

```bash
git add src/dashboard-ui/
git commit -m "feat: add Settings tab to dashboard — server config and project config UI"
```

---

## Task 21: Delete old files + final cleanup

- [ ] **Delete `src/server.ts`** — replaced by `src/plugins/mcp.ts` + `src/http-server.ts`

```bash
git rm src/server.ts
```

- [ ] **Delete `src/dashboard.ts`** — replaced by `src/plugins/dashboard.ts`

```bash
git rm src/dashboard.ts
```

- [ ] **Remove `.memory.json` from project root (if present)**

```bash
git rm .memory.json 2>/dev/null || true
```

- [ ] **Update `README.md` / docs — new server URL, no `.memory.json`**

Update any references to `.memory.json` → point to `~/.config/local-rag/config.json` and the dashboard Settings tab.

- [ ] **Final build + test**

```bash
pnpm build && pnpm test
```
Expected: build succeeds, tests pass.

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: HTTP foundation complete — MCP Streamable HTTP, hook endpoints, Qdrant config"
```

---

## Post-completion checklist

- [ ] `local-rag serve` starts cleanly with no `.memory.json`
- [ ] MCP at `http://127.0.0.1:7531/mcp?project=X&agent=Y` works from Claude Code
- [ ] `local-rag hook-recall` and `hook-remember` POST to server successfully
- [ ] Hook calls appear in dashboard log with `source: hook`
- [ ] Hook calls stored in Qdrant `hook_calls` with 7-day TTL
- [ ] Server config editable via dashboard Settings tab (LLM, embed, router)
- [ ] Project config editable via dashboard Settings tab (root, paths, indexer state)
- [ ] `local-rag init` creates project on server and configures hooks
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes with 0 TypeScript errors
