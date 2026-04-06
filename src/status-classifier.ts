import { embedBatch, embedOne } from "./embedder.js";
import type { Status } from "./types.js";

// ── Template phrases per status ────────────────────────────────────────────────

const TEMPLATES: Record<Status, string[]> = {
  in_progress: [
    "working on",
    "implementing",
    "trying to",
    "need to",
    "planning to",
    "currently doing",
    "in the middle of",
    "started",
    "beginning to",
    "writing",
    "building",
    "developing",
    "still working",
    "figuring out",
  ],
  resolved: [
    "done",
    "finished",
    "decided",
    "implemented",
    "solved",
    "confirmed",
    "completed",
    "fixed",
    "closed",
    "deployed",
    "merged",
    "released",
    "concluded",
    "settled",
    "determined",
    "established",
  ],
  open_question: [
    "unclear",
    "need to figure out",
    "not sure",
    "question:",
    "how do we",
    "what should",
    "wondering",
    "uncertain",
    "unsure",
    "need to decide",
    "open question",
    "still unknown",
    "to be determined",
    "TBD",
    "what is the right way",
  ],
  hypothesis: [
    "maybe",
    "what if",
    "could try",
    "idea:",
    "perhaps",
    "might be",
    "possibly",
    "hypothesis:",
    "theory:",
    "suspect that",
    "could be",
    "one approach",
    "proposal:",
    "suggestion:",
    "thinking about trying",
  ],
};

// ── Lazy-initialised embedding cache ──────────────────────────────────────────

interface TemplateEntry {
  status: Status;
  vec:    number[];
}

let _cache: TemplateEntry[] | null = null;
let _cachePromise: Promise<TemplateEntry[]> | null = null;

function getTemplateEmbeddings(): Promise<TemplateEntry[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;

  const statuses = Object.keys(TEMPLATES) as Status[];
  const phrases  = statuses.flatMap((s) => TEMPLATES[s]);

  _cachePromise = embedBatch(phrases).then((vecs) => {
    const entries: TemplateEntry[] = [];
    let i = 0;
    for (const status of statuses) {
      for (const _phrase of TEMPLATES[status]) {
        entries.push({ status, vec: vecs[i]! });
        i++;
      }
    }
    _cache = entries;
    return entries;
  });

  return _cachePromise;
}

// ── Cosine similarity ──────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify the status of a text chunk without an LLM call.
 *
 * Uses pre-computed embeddings for template phrases per status category.
 * Picks the nearest template via cosine similarity.
 * Language-agnostic — works in Russian, English, or mixed text.
 */
export async function classifyStatus(
  text: string
): Promise<{ status: Status; confidence: number }> {
  const [textVec, templates] = await Promise.all([
    embedOne(text),
    getTemplateEmbeddings(),
  ]);

  let bestStatus: Status = "open_question";
  let bestSim = -Infinity;

  for (const entry of templates) {
    const sim = cosineSim(textVec, entry.vec);
    if (sim > bestSim) {
      bestSim    = sim;
      bestStatus = entry.status;
    }
  }

  // cosine similarity is in [-1, 1]; map to [0, 1] for confidence
  const confidence = Math.max(0, Math.min(1, (bestSim + 1) / 2));
  return { status: bestStatus, confidence };
}

/** Warm up template embeddings eagerly (optional, call at server start). */
export function warmupStatusClassifier(): Promise<void> {
  return getTemplateEmbeddings().then(() => undefined);
}
