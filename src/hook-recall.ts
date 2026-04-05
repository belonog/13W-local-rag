import { debugLog, buildTranscriptContext } from "./util.js";
import { runArchivist } from "./archivist.js";

const CONTEXT_CHARS = 2_000; // recent conversation window passed to archivist

interface HookInput {
  session_id:      string;
  transcript_path: string;
  cwd:             string;
  hook_event_name: string;
  prompt:          string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end",  ()      => resolve(buf));
  });
}

export async function runHookRecall(): Promise<void> {
  try {
    const raw   = await readStdin();
    const input = JSON.parse(raw.trim() || "{}") as Partial<HookInput>;
    const prompt = (input.prompt ?? "").trim();

    if (!prompt) {
      process.stdout.write('{"systemMessage":""}\n');
      return;
    }

    // Build enriched context: recent transcript + current prompt.
    // This ensures short replies ("да", "1", "давай") carry enough context
    // for the archivist to form a meaningful Qdrant query.
    const transcriptCtx = buildTranscriptContext(
      input.transcript_path ?? "",
      CONTEXT_CHARS,
    );

    const archivistInput = transcriptCtx
      ? `${transcriptCtx}\n\nCurrent message: ${prompt}`
      : prompt;

    debugLog("hook-recall", `prompt="${prompt.slice(0, 100)}" ctx_chars=${transcriptCtx.length}`);

    const systemMessage = await runArchivist(archivistInput);
    process.stdout.write(JSON.stringify({ systemMessage }) + "\n");
  } catch {
    process.stdout.write('{"systemMessage":""}\n');
  }
}
