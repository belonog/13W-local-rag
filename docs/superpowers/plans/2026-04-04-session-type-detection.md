# Session Type Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill three remaining gaps in session-type detection: extract `agent_id` from `SubagentStop` events, log headless decisions to `.memory-headless.log`, and emit a `systemMessage` asking Claude to call `request_validation` for borderline-confidence ops in non-headless sessions.

**Architecture:** `detectSessionType` is widened to return `{ sessionType, agentId }`. Two new pure/utility functions — `logHeadlessDecision` and `buildValidationRequests` — are added to `src/util.ts`. `processOp` receives `agentId` and `cwd` from its caller; `runHookRemember` splits ops into three confidence bands and emits the systemMessage when appropriate.

**Tech Stack:** TypeScript, Node.js `fs.appendFileSync`, existing `RouterOp` type from `src/router.ts`.

---

## File Map

| File | Change |
|---|---|
| `src/hook-remember.ts` | Widen `detectSessionType` return, pass `agentId`+`cwd` to `processOp`, split ops into three bands, emit `systemMessage` |
| `src/util.ts` | Add `logHeadlessDecision`, `buildValidationRequests` |

No other files change.

---

## Task 1: Widen `detectSessionType` to return `{ sessionType, agentId }`

**Files:**
- Modify: `src/hook-remember.ts`

- [ ] **Step 1: Add `SessionDetection` interface and update function signature**

In `src/hook-remember.ts`, immediately after the `EDIT_TOOLS` constant, add the interface and rewrite `detectSessionType`:

```ts
// ── Session detection ─────────────────────────────────────────────────────────

interface SessionDetection {
  sessionType: SessionType;
  agentId:     string;
}

function detectSessionType(input: HookInput, lines: JsonLine[]): SessionDetection {
  if (input.stop_hook_active) {
    return { sessionType: "headless", agentId: cfg.agentId };
  }

  let hasEditTool = false;
  let hasSubagent = false;
  let agentId     = cfg.agentId;

  for (const line of lines) {
    if (String(line["type"] ?? "") === "SubagentStop") {
      hasSubagent = true;
      // Try to extract agent id from the event or its nested message.
      const candidates = [
        line["agent_id"],
        line["subagent_id"],
        line["sub_agent_id"],
        (line["message"] as JsonLine | undefined)?.["agent_id"],
        (line["message"] as JsonLine | undefined)?.["subagent_id"],
        (line["message"] as JsonLine | undefined)?.["sub_agent_id"],
      ];
      const found = candidates.find((v) => typeof v === "string" && v.trim() !== "");
      if (found) agentId = String(found);
      break;
    }
    const msg = line["message"] as JsonLine | undefined;
    if (!msg) continue;
    const content = msg["content"];
    if (!Array.isArray(content)) continue;
    for (const block of content as JsonLine[]) {
      if (block["type"] === "tool_use" && EDIT_TOOLS.has(String(block["name"] ?? ""))) {
        hasEditTool = true;
      }
    }
  }

  if (hasSubagent) return { sessionType: "multi_agent", agentId };
  if (hasEditTool) return { sessionType: "editing",     agentId };
  return                  { sessionType: "planning",    agentId };
}
```

Remove the old `detectSessionType` function (lines 84–109 of the original file).

- [ ] **Step 2: Update call site in `runHookRemember`**

Find the existing call:
```ts
const sessionType   = detectSessionType(input as HookInput, lines);
```
Replace with:
```ts
const { sessionType, agentId } = detectSessionType(input as HookInput, lines);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /opt/node/local-rag && npx tsc --noEmit
```
Expected: no errors (the `agentId` variable will be unused until Task 2 — add `void agentId;` temporarily if tsc complains about unused vars, remove it in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/hook-remember.ts
git commit -m "refactor: detectSessionType returns { sessionType, agentId }"
```

---

## Task 2: Pass `agentId` and `cwd` into `processOp`; replace `cfg.agentId`

**Files:**
- Modify: `src/hook-remember.ts`

- [ ] **Step 1: Update `processOp` signature**

Current signature:
```ts
async function processOp(
  op:          RouterOp,
  col:         string,
  sessionType: SessionType,
  sessionId:   string,
  threshold:   number,
): Promise<void>
```

New signature:
```ts
async function processOp(
  op:          RouterOp,
  col:         string,
  sessionType: SessionType,
  sessionId:   string,
  agentId:     string,
  cwd:         string,
  threshold:   number,
): Promise<void>
```

- [ ] **Step 2: Replace `cfg.agentId` with the parameter inside `processOp`**

Find this line inside the `qd.upsert` call in `processOp`:
```ts
agent_id:     cfg.agentId,
```
Replace with:
```ts
agent_id:     agentId,
```

- [ ] **Step 3: Update the call site in `runHookRemember`**

Find:
```ts
for (const op of ops) {
  await processOp(op, col, sessionType, sessionId, threshold).catch((err: unknown) => {
    process.stderr.write(`[hook-remember] op failed: ${String(err)}\n`);
  });
}
```
Replace with:
```ts
for (const op of ops) {
  await processOp(op, col, sessionType, sessionId, agentId, cwd, threshold).catch((err: unknown) => {
    process.stderr.write(`[hook-remember] op failed: ${String(err)}\n`);
  });
}
```

Also add `cwd` extraction near `sessionId`:
```ts
const sessionId = input.session_id ?? "unknown";
const cwd       = input.cwd ?? process.cwd();
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /opt/node/local-rag && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hook-remember.ts
git commit -m "feat: thread agentId and cwd through processOp"
```

---

## Task 3: Add `logHeadlessDecision` to `util.ts`

**Files:**
- Modify: `src/util.ts`

- [ ] **Step 1: Add import for `appendFileSync` at top of `util.ts`**

Change:
```ts
import { createHash } from "node:crypto";
```
To:
```ts
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
```

- [ ] **Step 2: Add the `RouterOp` import**

After the existing imports in `util.ts`, add:
```ts
import type { RouterOp } from "./router.js";
```

- [ ] **Step 3: Add `logHeadlessDecision` function**

Append to `src/util.ts`:
```ts
/**
 * Append one line to {cwd}/.memory-headless.log describing a headless-session
 * write/skip decision. Errors are suppressed — logging must never block the hook.
 */
export function logHeadlessDecision(
  cwd:     string,
  op:      RouterOp,
  written: boolean,
): void {
  try {
    const ts      = new Date().toISOString();
    const outcome = written ? "written" : "skipped";
    const conf    = op.confidence.toFixed(2);
    const text    = op.text.replace(/\n/g, " ").slice(0, 120);
    const line    = `${ts}  ${outcome.padEnd(7)}  conf=${conf}  ${op.status.padEnd(14)}  "${text}"\n`;
    appendFileSync(`${cwd}/.memory-headless.log`, line, "utf8");
  } catch {
    // intentionally silent
  }
}
```

- [ ] **Step 4: Call `logHeadlessDecision` from `processOp` in `hook-remember.ts`**

At the end of `processOp` (before the closing `}`), add:

```ts
  if (sessionType === "headless") {
    logHeadlessDecision(cwd, op, /* written= */ true);
  }
```

For the **skipped** case (when `op.confidence < threshold`) the op never enters `processOp`. Handle this in `runHookRemember` in Task 4 after splitting into bands. This step only covers the "written" path.

- [ ] **Step 5: Add import in `hook-remember.ts`**

Add `logHeadlessDecision` to the existing `util.ts` import line:
```ts
import { contentHash, nowIso, logHeadlessDecision } from "./util.js";
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /opt/node/local-rag && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/util.ts src/hook-remember.ts
git commit -m "feat: log headless write decisions to .memory-headless.log"
```

---

## Task 4: Add `buildValidationRequests` to `util.ts`

**Files:**
- Modify: `src/util.ts`

- [ ] **Step 1: Append `buildValidationRequests` to `util.ts`**

```ts
/**
 * Format borderline-confidence ops as a systemMessage asking Claude to call
 * the request_validation MCP tool for each entry.
 * Returns null when the list is empty.
 */
export function buildValidationRequests(ops: RouterOp[]): string | null {
  if (ops.length === 0) return null;

  const lines = [
    "Memory router needs validation for the following entries.",
    "Call request_validation for each:",
    "",
  ];

  ops.forEach((op, i) => {
    lines.push(
      `${i + 1}. text: "${op.text.replace(/\n/g, " ").slice(0, 200)}" | status: ${op.status} | confidence: ${op.confidence.toFixed(2)}`,
    );
  });

  return lines.join("\n");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /opt/node/local-rag && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/util.ts
git commit -m "feat: add buildValidationRequests helper"
```

---

## Task 5: Split ops into three confidence bands + emit systemMessage

**Files:**
- Modify: `src/hook-remember.ts`

- [ ] **Step 1: Add `VALIDATION_MIN_CONFIDENCE` constant**

Near the existing threshold constants at the top of `hook-remember.ts`:
```ts
const VALIDATION_MIN_CONFIDENCE = 0.5;
```

- [ ] **Step 2: Add `buildValidationRequests` to the import**

```ts
import { contentHash, nowIso, logHeadlessDecision, buildValidationRequests } from "./util.js";
```

- [ ] **Step 3: Replace the ops-processing loop in `runHookRemember`**

Find the current loop:
```ts
// Process ops sequentially to avoid hammering the embedder.
for (const op of ops) {
  await processOp(op, col, sessionType, sessionId, agentId, cwd, threshold).catch((err: unknown) => {
    process.stderr.write(`[hook-remember] op failed: ${String(err)}\n`);
  });
}
```

Replace with:
```ts
// Split into three bands.
const directOps:     RouterOp[] = [];
const validationOps: RouterOp[] = [];

for (const op of ops) {
  if (op.confidence >= threshold) {
    directOps.push(op);
  } else if (op.confidence >= VALIDATION_MIN_CONFIDENCE && sessionType !== "headless") {
    validationOps.push(op);
  } else if (sessionType === "headless") {
    // Log skipped headless ops.
    logHeadlessDecision(cwd, op, /* written= */ false);
  }
}

// Write high-confidence ops directly.
for (const op of directOps) {
  await processOp(op, col, sessionType, sessionId, agentId, cwd, threshold).catch((err: unknown) => {
    process.stderr.write(`[hook-remember] op failed: ${String(err)}\n`);
  });
}

// Emit systemMessage for validation candidates (non-headless only).
const systemMessage = buildValidationRequests(validationOps);
if (systemMessage) {
  process.stdout.write(JSON.stringify({ systemMessage }) + "\n");
}
```

Note: `RouterOp` is already imported via `import { runRouter, type RouterOp } from "./router.js"` — verify this import exists, add `RouterOp` if missing.

- [ ] **Step 4: Verify `RouterOp` is imported**

Check `hook-remember.ts` imports. If the import reads:
```ts
import { runRouter } from "./router.js";
```
Change to:
```ts
import { runRouter, type RouterOp } from "./router.js";
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /opt/node/local-rag && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Manual smoke test — headless skip logging**

Create a minimal fake transcript and pipe it to the built hook to verify `.memory-headless.log` is written. First build:
```bash
cd /opt/node/local-rag && pnpm build 2>&1 | tail -5
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/hook-remember.ts
git commit -m "feat: split ops into confidence bands, emit systemMessage for validation"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Detect session type: planning/editing/headless/multi_agent | Already implemented; `detectSessionType` return type widened in Task 1 |
| `session_type` in every Qdrant payload | Already implemented; unchanged |
| `agent_id` from `SubagentStop` event | Task 1 (extraction) + Task 2 (threading) |
| multi_agent → `memory_agents` collection | Already implemented; unchanged |
| Main agent reads from both namespaces | Already implemented; unchanged |
| headless: skip request_validation | Task 5 (validation ops only collected for non-headless) |
| headless: confidence threshold 0.85 | Already implemented; unchanged |
| headless: log to `.memory-headless.log` | Task 3 (written) + Task 5 (skipped) |

All requirements covered.

**Placeholder scan:** None found.

**Type consistency:**
- `SessionDetection` defined in Task 1, used in Task 1 only (internal to `hook-remember.ts`) ✓
- `RouterOp` imported from `router.ts`, used in `util.ts` (Task 3, 4) and `hook-remember.ts` (Task 5) ✓
- `logHeadlessDecision(cwd, op, written)` — signature defined in Task 3, called in Task 3 (written path) and Task 5 (skipped path), both pass matching args ✓
- `buildValidationRequests(ops)` — defined in Task 4, imported and called in Task 5 ✓
- `processOp(op, col, sessionType, sessionId, agentId, cwd, threshold)` — signature widened in Task 2, call site updated in Task 2 ✓
