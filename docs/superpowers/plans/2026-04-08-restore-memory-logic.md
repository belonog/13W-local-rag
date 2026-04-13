# Restore memory Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the primary session memory logic using the `memory` and `memory_agents` collections with the correct schema and session-type routing.

**Architecture:**
- Expand `MemoryType` to include `memory` and `memory_agents`.
- Update `storeMemory` in `util.ts` to handle both legacy (`episodic/semantic/procedural`) and new (`memory/memory_agents`) schemas.
- Correct `src/plugins/hooks.ts` to use proper session type detection and routing.
- Enable searching these collections in `recall.ts`.

**Tech Stack:** TypeScript, Qdrant, Node.js.

---

### Task 1: Update Types and `storeMemory` Validation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/util.ts`

- [ ] **Step 1: Expand `MemoryType` in `src/types.ts`**

Update `MemoryType` to:
```typescript
export type MemoryType = "episodic" | "semantic" | "procedural" | "memory" | "memory_agents";
```

- [ ] **Step 2: Update `storeMemory` in `src/util.ts`**

Modify the function to allow all 5 types and handle field mapping (`text` vs `content`, `confidence` vs `importance`) based on the collection type.

- [ ] **Step 3: Verify compilation**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/util.ts
git commit -m "feat: allow 'memory' and 'memory_agents' types in storeMemory"
```

---

### Task 2: Restore Session Type Detection and Routing in `hooks.ts`

**Files:**
- Modify: `src/plugins/hooks.ts`

- [ ] **Step 1: Implement `detectSessionType` helper**

Create a helper that analyzes the transcript lines for edit tools or subagent events.

- [ ] **Step 2: Update `/hooks/remember` handler**

Use `detectSessionType` to determine the `sessionType` and `agentId`. Route to `memory` or `memory_agents` accordingly. Set appropriate confidence thresholds.

- [ ] **Step 3: Verify compilation**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/hooks.ts
git commit -m "feat: restore session type detection and correct collection routing"
```

---

### Task 3: Include `memory` and `memory_agents` in `recall` searches

**Files:**
- Modify: `src/tools/recall.ts`

- [ ] **Step 1: Update `recallTool` collection list**

Add `memory` and `memory_agents` to the default search list.

- [ ] **Step 2: Support `text` field in result formatting**

Update the result mapping to check for both `text` and `content` fields in the payload.

- [ ] **Step 3: Verify compilation**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/recall.ts
git commit -m "feat: include 'memory' collections in recall search and support 'text' field"
```

---

### Task 4: Verification

- [ ] **Step 1: Restart server**

Build and restart.

- [ ] **Step 2: Manual test of 'remember' with type 'memory'**

Verify successful storage.

- [ ] **Step 3: Manual test of 'recall'**

Verify the stored memory is retrieved.
