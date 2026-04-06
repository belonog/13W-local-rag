# HTTP Foundation Design

**Date:** 2026-04-06  
**Status:** Approved  
**Scope:** Phase 1 of local-rag evolution into a standalone memory server

---

## Context

local-rag started as an MCP server for a single Claude Code session (stdio transport). The project has grown: multiple AI clients (Claude Code, Gemini, Cursor) run on the same machine, multi-agent workflows are common, and visibility into memory usage matters. This phase turns local-rag into a proper standalone HTTP service:

- MCP Streamable HTTP transport replaces stdio
- Hook logic moves into HTTP endpoints (subprocesses become thin clients)
- Configuration moves from `.memory.json` into Qdrant (server-level and project-level)
- Multiple clients identify themselves via URL query parameters
- Server always runs on `127.0.0.1` — local machine only, no network exposure

---

## Architecture

### Before

```
src/server.ts        — MCP stdio server
src/dashboard.ts     — Fastify HTTP server (optional)
src/hook-recall.ts   — subprocess: stdin → archivist → stdout
src/hook-remember.ts — subprocess: stdin → router → Qdrant → stdout
.memory.json         — all configuration
```

### After

```
src/http-server.ts        — unified Fastify server (replaces both)
src/plugins/
  mcp.ts                  — MCP Streamable HTTP (POST/GET/DELETE /mcp)
  hooks.ts                — hook endpoints
  dashboard.ts            — dashboard (moved from src/dashboard.ts)
src/hook-recall.ts        — thin HTTP client (~20 lines)
src/hook-remember.ts      — thin HTTP client (~20 lines)
src/server.ts             — DELETED
src/dashboard.ts          — DELETED
.memory.json              — DELETED (replaced by Qdrant + ~/.config/local-rag/config.json)
```

One process, one port, `127.0.0.1` only.

---

## Bootstrap & Configuration

### Three-tier configuration

```
~/.config/local-rag/config.json   — Qdrant connection (minimal, local file)
Qdrant: server_config collection  — global server settings (LLM, embed, port)
Qdrant: projects collection       — per-project settings (root, paths, indexer state)
```

### `~/.config/local-rag/config.json`

Qdrant connection params + last known server port:

```json
{
  "qdrant": {
    "url": "http://localhost:6333",
    "api_key": "",
    "tls": false,
    "prefix": ""
  },
  "port": 7531
}
```

Server writes `port` to this file at startup (actual bound port). Hook subprocesses read it to know where to POST.

### `local-rag serve` startup sequence

1. Read `~/.config/local-rag/config.json`
2. If missing: try `http://localhost:6333` (Qdrant default)
3. If unreachable: prompt user for Qdrant URL (+ optional api_key, tls)
4. On success: write `~/.config/local-rag/config.json`
5. Load server config from Qdrant `server_config` collection
6. If `server_config` empty (first run): start with safe defaults, server works but LLM features inactive until configured via dashboard
7. Start Fastify on `127.0.0.1:7531` (default) or configured port
8. Write actual bound port to `~/.config/local-rag/config.json` → `"port"`

### Qdrant `server_config` collection (one document, id = "global")

```json
{
  "embed": {
    "provider": "ollama",
    "model": "embeddinggemma:300m",
    "api_key": "",
    "dim": 768,
    "url": ""
  },
  "llm": {
    "provider": "ollama",
    "model": "gemma3n:e2b",
    "api_key": "",
    "url": ""
  },
  "router": {
    "provider": "ollama",
    "model": "gemma3n:e2b",
    "api_key": "",
    "url": "",
    "fallback": null
  },
  "collection_prefix": "",
  "port": 7531,
  "updated_at": "2026-04-06T00:00:00Z"
}
```

### Qdrant `projects` collection (one document per project_id)

```json
{
  "project_id": "my-project",
  "display_name": "My Project",
  "agent_id": "my-agent",
  "project_root": "/path/to/project",
  "include_paths": [],
  "indexer_state": "stopped",
  "created_at": "2026-04-06T00:00:00Z",
  "updated_at": "2026-04-06T00:00:00Z"
}
```

`indexer_state`: `"running"` | `"paused"` | `"stopped"` — managed from dashboard.  
`generate_descriptions` removed — always true.  
`no_watch` removed — replaced by `indexer_state`.

---

## `local-rag init` — Project Setup

Interactive command, assumes server is already running:

1. Connect to local server (`http://127.0.0.1:PORT` from `~/.config/local-rag/config.json` or default)
2. Prompt: **Project name** (default: current directory name)
3. Prompt: **Agent name** (default: same as project name)
4. Initialize hooks in `.claude/settings.json` (same as current `init` behavior)
5. `POST /api/projects` — create project config on server (indexer_state: "stopped")
6. Print: `Dashboard: http://127.0.0.1:PORT/?project=<project_id>` — user opens and configures (project root, include paths, LLM settings if not set, start indexer when ready)

---

## MCP Streamable HTTP Transport

**Spec:** MCP 2025-03-26  
**Implementation:** `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`

### Endpoints

```
POST   /mcp?project=<projectId>&agent=<agentId>
GET    /mcp?project=<projectId>&agent=<agentId>
DELETE /mcp?project=<projectId>&agent=<agentId>
```

Query params are optional — fall back to `"default"` if absent. The server extracts `project` and `agent` from the query string and injects them into the context for every tool call. Tools that write to Qdrant (remember, forget, etc.) use these values as `project_id` / `agent_id`.

### Client configuration

```json
// Claude Code settings.json
{ "url": "http://127.0.0.1:7531/mcp?project=my-project&agent=claude" }

// Gemini
{ "url": "http://127.0.0.1:7531/mcp?project=my-project&agent=gemini" }
```

All 14 existing MCP tools remain unchanged — only transport and context injection change.

---

## Hook Endpoints

### `src/plugins/hooks.ts`

```
POST /hooks/recall    — archivist logic (was: hook-recall subprocess)
POST /hooks/remember  — router logic (was: hook-remember subprocess)
```

Both accept the existing JSON body (unchanged contract):
`{ session_id, transcript_path, cwd, hook_event_name, prompt, stop_hook_active? }`

Both return `{ systemMessage: string }`.

Project/agent context comes from the body's `cwd` field (matched to a project by `project_root`) — not from query params, since hook subprocesses don't control the URL.

### Subprocess clients

`src/hook-recall.ts` and `src/hook-remember.ts` become ~20-line fetch wrappers:

1. Read JSON from stdin
2. `POST` to `${serverUrl}/hooks/recall` (or `/hooks/remember`)
3. Write response JSON to stdout
4. On timeout / connection error: write `{}` to stdout — never break a session

**Server URL resolution** (priority):
1. `MEMORY_SERVER_URL` env var
2. `~/.config/local-rag/config.json` → `"port"` (written by server at startup) → `http://127.0.0.1:{port}`
3. Default: `http://127.0.0.1:7531`

---

## Unified Request Log + Hook Call Storage

### Extended `RequestEntry`

Existing fields unchanged. New `"hook"` source + optional hook fields:

```ts
interface RequestEntry {
  ts:        number;
  tool:      string;          // tool name | "recall" | "remember" | file path
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
  found?:      number;      // recall: memories found
  summary?:    string;      // recall: archivist summary (truncated ~200 chars)
  written?:    number;      // remember: directly written
  validated?:  number;      // remember: sent for validation
  discarded?:  number;      // remember: below threshold
  facts?:      string[];    // remember: first 3–5 extracted facts
}
```

### Qdrant `hook_calls` collection

Same payload as `RequestEntry` plus `expires_at` (Unix seconds, now + 7 days).  
No vector. Queries use payload filters (scroll by `project_id` + `expires_at > now`).  
Physical deletion: deferred to existing periodic GC.

Hook entries appear in the dashboard request log SSE stream alongside MCP and watcher events.

---

## Server-Level Logging

| Before | After |
|--------|-------|
| `"debug-log-path"` in `.memory.json` | `MEMORY_DEBUG_LOG=/path/file.log` env var |
| stderr for everything | stderr for critical errors only |
| No structured logging | `MEMORY_LOG_LEVEL` enables Fastify/pino logger |

`debugLog()` in `src/util.ts` reads `process.env.MEMORY_DEBUG_LOG`.  
Debug file: full hook input + LLM responses, one JSON line per event.

---

## Dashboard: Configuration Tab

New tab **"Settings"** in the Angular dashboard:

**Server settings** (global, affects all projects):
- Embed: provider, model, api_key, dim, url
- LLM: provider, model, api_key, url
- Router: provider, model, api_key, url, fallback
- Collection prefix
- Port (requires restart)

**Project settings** (per project, selected via project dropdown):
- Project root path
- Include paths (list)
- Indexer state: Start / Pause / Stop buttons
- Display name, agent name

Settings are saved via `PUT /api/config/server` and `PUT /api/projects/:projectId`.  
Changes to embed/LLM settings take effect immediately (no restart needed, config reloaded from Qdrant).

---

## Files Changed

| File | Action |
|------|--------|
| `~/.config/local-rag/config.json` | NEW — Qdrant connection bootstrap |
| `src/http-server.ts` | CREATE — unified Fastify entry point |
| `src/plugins/mcp.ts` | CREATE — MCP Streamable HTTP plugin |
| `src/plugins/hooks.ts` | CREATE — hook endpoints plugin |
| `src/plugins/dashboard.ts` | CREATE — dashboard plugin (from dashboard.ts) |
| `src/hook-recall.ts` | SIMPLIFY — thin fetch client |
| `src/hook-remember.ts` | SIMPLIFY — thin fetch client |
| `src/config.ts` | REWRITE — loads from Qdrant instead of .memory.json |
| `src/util.ts` | MODIFY — debugLog reads env var |
| `src/init.ts` | MODIFY — interactive project setup flow |
| `src/dashboard.ts` | DELETE |
| `src/server.ts` | DELETE |
| `src/bin.ts` | MODIFY — serve → http-server.ts |
| `src/dashboard-ui/src/types.ts` | MODIFY — extend RequestEntry, add config types |
| `src/dashboard-ui/src/app/` | MODIFY — add Settings tab component |
| `.memory.json` | DELETED from all projects |

---

## Verification

1. **Bootstrap:** `local-rag serve` with no config file → prompts for Qdrant URL → writes `~/.config/local-rag/config.json` → server starts
2. **MCP:** `curl -X POST 'http://127.0.0.1:PORT/mcp?project=test&agent=claude'` with initialize payload → valid JSON-RPC response
3. **Tool context:** call `recall` via MCP with `?project=my-project` → results scoped to that project only
4. **Hook recall:** `echo '{...}' | local-rag hook-recall` → returns `{"systemMessage":"..."}`
5. **Hook remember:** trigger hook → `hook_calls` collection in Qdrant gets a new point with 7-day TTL
6. **Dashboard log:** hook entries visible with `source: "hook"`, facts and counts shown
7. **Settings tab:** change LLM model via dashboard → next tool call uses new model
8. **Init:** `local-rag init` in a new project → hooks configured, project appears in dashboard
9. **Multi-client:** Claude Code + Gemini both connected with different `?agent=` params → both visible in hook log with correct agent_id
10. **Graceful fail:** stop server, trigger hook → subprocess returns `{}`, session continues
