# README Update Design — v2 Architecture

**Date:** 2026-04-19
**Scope:** Update README.md to reflect v2 HTTP server architecture, new CLI commands, provider additions, and v1→v2 migration guide.

---

## What changed since the current README was written

| Area | Old (v1) | New (v2) |
|------|----------|----------|
| MCP transport | stdio process | Streamable HTTP (`/mcp?project=&agent=`) |
| Config | `.memory.json` per project | Machine config `~/.config/local-rag/config.json`; server config in Qdrant (via dashboard) |
| Setup | `claude mcp add` with command args | `local-rag serve` → `local-rag init` |
| Gemini support | none | `llm-provider: "gemini"`, `embed-provider: "gemini"`; `init` writes `.gemini/settings.json` |
| `re-embed` CLI | missing | added — re-generates vectors in-place when switching embedding models |
| `give_feedback` tool | missing | internal tool (not user-facing; omit from docs) |

---

## Section changes

### 1. "What it does" — tool table

No count change (stays at 9 public tools). `give_feedback` and `request_validation` are internal.

### 2. "Claude Code Plugin Setup" — complete rewrite

Remove all three Options (A/B/C) using `claude mcp add` with stdio args. Replace with:

**Step 1 — Start the server**

```bash
local-rag serve
```

First run prompts interactively for Qdrant URL and saves `~/.config/local-rag/config.json`. Server starts on port 7531 by default.

**Step 2 — Register your project**

Run once in your project root (server must be running):

```bash
local-rag init
```

`init` will:
- Prompt for project name and agent name
- Register the project on the running server
- Write MCP connection (`type: "http"`) + hooks to `.claude/settings.local.json`
- Write `.gemini/settings.json` if a `.gemini/` directory exists (Gemini CLI support)
- Print the dashboard URL for this project

Commit `.claude/settings.json` to share the MCP server URL with your team.

**Output table update:**

| File | Purpose |
|------|---------|
| `.claude/settings.local.json` | MCP server URL + hooks (machine-local, do not commit) |

### 3. "Configuration" — complete rewrite

Remove `.memory.json` section entirely. Replace with a 3-layer table:

| Layer | Location | What it controls |
|-------|----------|-----------------|
| Machine | `~/.config/local-rag/config.json` (auto-created by `serve`) | Qdrant URL, API key, server port |
| Server | Qdrant collection, managed via dashboard | Embedding model/provider, LLM provider, rate limits, collection prefix |
| Project | Registered via `init`, managed via dashboard | Project root, include paths, indexer state |

Add `gemini` to provider tables:

- `embed-provider`: `ollama`, `openai`, `voyage`, `gemini` — uses `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `llm-provider`: `ollama`, `anthropic`, `openai`, `gemini` — uses `GEMINI_API_KEY` or `GOOGLE_API_KEY`

When using `gemini` as a provider, `embed-model` and `llm-model` must be set explicitly (no built-in default).

### 4. "Indexing Your Codebase" — add `re-embed`

Add to "Other indexer commands":

```bash
local-rag re-embed   # re-generate all vectors (use when switching embedding models of same dimension)
```

### 5. New section: "Upgrading from v1 to v2"

```markdown
## Upgrading from v1 to v2

v2 replaces the per-project stdio MCP process with a single persistent HTTP server.

**1. Remove old MCP entry** from `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`:
   delete any `mcpServers.memory` entry with `type: "stdio"` or a `command` field

**2. Remove old hook files** (if present):
   rm .claude/hooks/prompt-reminder.sh
   rm .claude/hooks/session-start.sh

**3. Remove old rules files** (if present):
   rm .claude/rules/continuous-remember.md
   rm .claude/rules/memory-protocol-reference.md
   rm .claude/rules/serena-conventions.md

**4. Remove old hooks from settings**
   In `.claude/settings.json` / `settings.local.json`, delete hook entries for:
   - `SubagentStop`
   - `PreToolUse`
   - `UserPromptSubmit` / `Stop` entries running `hook-recall --config .memory.json`
     or `hook-remember --config .memory.json`

**5. Clean CLAUDE.md**
   Remove any "Memory system" or "Cognitive Memory Layer" block added by local-rag v1.

**6. Re-register with v2:**
   local-rag serve
   local-rag init
```

---

## Out of scope

- Changes to "Stack", "Prerequisites", "Live Dashboard", "Memory Types", or "Agent Protocol" sections — these are accurate
- `search_code` modes / reranker section — no changes
- Symbol-aware workflow section — no changes
