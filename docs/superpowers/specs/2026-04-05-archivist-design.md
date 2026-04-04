# Archivist — LLM-powered memory retrieval

## Context

`hook-recall` currently does a direct cosine search in `gemma_memory` with `MIN_SCORE=0.6`.
Two problems:
1. Russian queries vs English stored memories → low similarity, misses
2. No query understanding — can't expand, filter by status/tags, or pick collections

Replace with Gemma4 as an "archivist": it receives the user prompt, uses `search_memory` tool
to query Qdrant on its own terms, evaluates relevance, returns context to Claude.

---

## Architecture

```
server startup
    └─ buildProjectProfile() → samples Qdrant → stores in gemma_memory[_type=project-profile]

UserPromptSubmit
    └─ hook-recall.ts
           └─ archivist.ts
                  ├─ loadProjectProfile() ← Qdrant (cached 24h)
                  ├─ llm-client.ts → Gemma4 (system: profile, user: prompt, tools: [search_memory])
                  │       └─ Gemma4 calls search_memory(query, collections?, filters?)
                  ├─ Node.js executes Qdrant search, returns results to Gemma4
                  └─ Gemma4 returns final text → systemMessage → Claude
```

---

## Components

### `src/llm-client.ts` (new)

Shared LLM client extracted from `router.ts`, with tool-calling support.

```typescript
interface Message   { role: "user"|"assistant"|"tool"; content: string; tool_call_id?: string }
interface ToolDef   { name: string; description: string; parameters: Record<string, unknown> }
interface ToolCall  { id: string; name: string; args: Record<string, unknown> }
interface LlmResponse { text: string | null; toolCalls: ToolCall[] | null }

export async function callLlm(
  messages: Message[],
  tools:    ToolDef[],
  spec:     RouterProviderSpec,
): Promise<LlmResponse>
```

Each provider (Ollama, Gemini, OpenAI, Anthropic) translates `ToolDef[]` into its native format and
normalises the response back to `LlmResponse`.

---

### `src/archivist.ts` (new)

```typescript
export async function runArchivist(prompt: string): Promise<string>
```

Flow:
1. `loadProjectProfile()` — fetch from Qdrant (`_type=project-profile`, max age 24h). Returns cached or null.
2. Build system prompt from profile (topics, tags, collection stats).
3. Call `callLlm([system, user], [SEARCH_MEMORY_TOOL], routerSpec)` — single turn with possible tool call.
4. If `toolCalls`: execute `search_memory` against Qdrant, feed results back in next message, call again.
5. Return `text` (Gemma4's final answer) or `""` if empty.

**`search_memory` tool schema:**
```json
{
  "name": "search_memory",
  "description": "Search project memory for relevant context",
  "parameters": {
    "query":       { "type": "string" },
    "collections": { "type": "array", "items": { "type": "string" },
                     "description": "memory | episodic | semantic | procedural" },
    "status":      { "type": "string", "enum": ["in_progress","resolved","open_question","hypothesis",""] },
    "tags":        { "type": "array", "items": { "type": "string" } },
    "limit":       { "type": "integer", "default": 10 }
  },
  "required": ["query"]
}
```

---

### Project Profile

Stored in `gemma_memory` as a regular point with payload `{ _type: "project-profile" }`.

```typescript
interface ProjectProfile {
  projectId:       string;
  builtAt:         string;         // ISO
  topTags:         string[];       // top-20 tags across all collections
  topTopics:       string[];       // extracted by Gemma4 from sample texts
  collectionStats: Record<string, number>;
  sampleTexts:     string[];       // 10-15 random entries used to build profile
}
```

**`buildProjectProfile()` in `src/server.ts`:**
1. Check Qdrant for existing profile with `_type=project-profile` and `builtAt` < 24h → return cached.
2. Sample up to 30 random points from `gemma_memory`, `gemma_memory_episodic`, `gemma_memory_semantic`.
3. Call Gemma4 (no tools): "extract key topics and terminology from these texts".
4. Collect top tags from payload across sampled points.
5. Store profile as new point in `gemma_memory`.

---

### Modified files

**`src/router.ts`** — remove `callOllama/callAnthropic/callOpenAI/callGemini/callProvider`.
Use `callLlm(messages, [], spec)` from `llm-client.ts`. Behaviour identical.

**`src/hook-recall.ts`** — remove all Qdrant search logic.
```typescript
const context = await runArchivist(prompt);
process.stdout.write(JSON.stringify({ systemMessage: context }) + "\n");
```

---

## Data flow example

```
prompt: "как работают хуки?"
  → Gemma4 system: "project: memory. topics: MCP, hooks, Qdrant, memory extraction..."
  → Gemma4 calls: search_memory({ query: "hooks implementation session trigger", collections: ["memory","episodic"] })
  → Qdrant returns 5 hits
  → Gemma4: "Relevant context: hook-recall fires on UserPromptSubmit..."
  → systemMessage → Claude
```

---

## Error handling

- `buildProjectProfile()` failure at startup: log to stderr, skip (archivist runs without profile).
- `loadProjectProfile()` failure: archivist runs with empty system context (falls back to raw cosine).
- `search_memory` tool execution error: return `{ results: [] }` to Gemma4, let it decide.
- Gemma4 call failure: fall back to direct cosine search (existing `hook-recall` logic kept as fallback).

---

## Verification

1. Restart MCP server → check stderr for `[archivist] profile built` or `[archivist] profile cached`
2. Send a prompt → check `/tmp/local-rag-debug.log` for:
   - `[archivist] prompt=...`
   - `[archivist] tool_call search_memory query=...`
   - `[archivist] search results=N`
   - `[archivist] response len=N`
3. Check that systemMessage injected into Claude contains relevant context
4. Test cross-language: Russian prompt → Gemma4 should search with English terms
