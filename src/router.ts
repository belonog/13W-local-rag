/**
 * LLM router — memory extraction from conversation transcripts.
 * Provider calling is delegated to llm-client.ts.
 */

import { cfg } from "./config.js";
import { callLlmSimple, defaultRouterSpec } from "./llm-client.js";
import { debugLog } from "./util.js";
import type { Status } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouterOp {
  text:       string;
  status:     Status;
  confidence: number;
}

// ── Router prompt ─────────────────────────────────────────────────────────────

const ROUTER_PROMPT =
  "You are a memory extraction system for an AI coding agent. Your goal is to capture high-value insights, research findings, and technical discoveries.\n" +
  "Analyze the conversation and tool usage logs to extract items worth persisting across sessions.\n\n" +
  "GUIDELINES:\n" +
  "1. RESEARCH FINDINGS: Extract discoveries made during tool usage (e.g., 'Gemma 2.0 has a bug with tool calling when enum is empty', 'The library X is not available on FreeBSD').\n" +
  "2. ROOT CAUSES: If a problem was investigated, extract the root cause and the fix.\n" +
  "3. RESOLVED ISSUES: When a problem mentioned earlier is fixed, mark it as 'resolved'.\n" +
  "4. ARCHITECTURAL DECISIONS: Record any agreed-upon patterns or directions.\n" +
  "5. STAND-ALONE TEXT: Ensure the 'text' field is clear and descriptive without needing the full context.\n\n" +
  "For each item output JSON: { \"text\": \"...\", \"status\": \"...\", \"confidence\": 0.0-1.0 }\n" +
  "Status: in_progress, resolved, open_question, hypothesis\n" +
  "Only include items with confidence > 0.6.\n" +
  "Output a JSON array only. No explanation. No markdown.\n\n" +
  "Transcript excerpt (includes tool calls and summarized results):\n";

// ── Response parsing ──────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<string>(["in_progress", "resolved", "open_question", "hypothesis"]);

function parseOps(raw: string): RouterOp[] {
  const candidates: string[] = [];
  
  // 1. Find all possible array blocks [...]
  const arrayRe = /\[[\s\S]*?\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRe.exec(raw)) !== null) candidates.push(m[0]);

  // 2. If no arrays, maybe it's a list of separate objects { ... } { ... }
  if (candidates.length === 0) {
    const objRe = /\{[\s\S]*?\}/g;
    while ((m = objRe.exec(raw)) !== null) candidates.push(m[0]);
  }

  // 3. Fallback: take everything from the first [ or { to the end
  const firstBracket = Math.min(
    raw.indexOf("[") === -1 ? Infinity : raw.indexOf("["),
    raw.indexOf("{") === -1 ? Infinity : raw.indexOf("{")
  );
  if (firstBracket !== Infinity) {
    candidates.push(raw.slice(firstBracket));
  }

  let parsed: unknown[] = [];
  let found = false;

  // Try candidates from longest to shortest
  const sorted = candidates.sort((a, b) => b.length - a.length);

  for (const candidate of sorted) {
    try {
      const p = JSON.parse(candidate);
      if (Array.isArray(p)) {
        parsed = p;
        found = true;
        break;
      }
      if (typeof p === "object" && p !== null) {
        parsed = [p]; // single object becomes one-item array
        found = true;
        break;
      }
    } catch {
      // maybe it's truncated? try to close brackets
      try {
        if (candidate.startsWith("[")) {
          parsed = JSON.parse(candidate + "]") as unknown[];
          found = true;
          break;
        }
      } catch { /* skip */ }
    }
  }

  if (!found) return [];

  return parsed.flatMap((item) => {
    if (typeof item !== "object" || !item) return [];
    const o = item as Record<string, unknown>;
    const text = String(o["text"] ?? "").trim();
    if (!text) return [];
    const status = String(o["status"] ?? "");
    if (!VALID_STATUSES.has(status)) return [];
    const confidence = Number(o["confidence"] ?? 0);
    if (isNaN(confidence) || confidence < 0.4) return [];
    return [{ text, status: status as Status, confidence }];
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the LLM router on a transcript window.
 * Returns extracted memory operations. Returns [] on any error.
 */
export async function runRouter(window: string): Promise<RouterOp[]> {
  const primarySpec  = cfg.routerConfig ?? defaultRouterSpec();
  const fallbackSpec = cfg.routerConfig?.fallback ?? null;
  const prompt       = ROUTER_PROMPT + window;

  debugLog("router", `calling provider=${primarySpec.provider} model=${primarySpec.model} prompt_len=${prompt.length}`);

  const raw = await (async () => {
    try {
      const r = await callLlmSimple(prompt, primarySpec);
      debugLog("router", `primary response len=${r.length}`);
      return r;
    } catch (primaryErr: unknown) {
      process.stderr.write(`[router] primary failed: ${String(primaryErr)}\n`);
      debugLog("router", `primary failed: ${String(primaryErr)}`);
      if (!fallbackSpec) return "";
      debugLog("router", `trying fallback provider=${fallbackSpec.provider} model=${fallbackSpec.model}`);
      try {
        const r = await callLlmSimple(prompt, fallbackSpec);
        debugLog("router", `fallback response len=${r.length}`);
        return r;
      } catch (fallbackErr: unknown) {
        process.stderr.write(`[router] fallback failed: ${String(fallbackErr)}\n`);
        debugLog("router", `fallback failed: ${String(fallbackErr)}`);
        return "";
      }
    }
  })();

  if (!raw) return [];

  // Log the full raw response for debugging before parsing
  debugLog("router", `raw response: ${raw}`);

  const ops = parseOps(raw);
  debugLog("router", `parsed ops=${ops.length}`);
  if (ops.length === 0 && raw.trim()) {
    debugLog("router", `parsing failed, raw head: ${raw.trim().slice(0, 300)}...`);
  }
  return ops;
}
