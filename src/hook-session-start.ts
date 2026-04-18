const SESSION_START_MESSAGE = `# Memory System Active (local-rag)

Your memory MCP is connected. Use it as cognitive infrastructure — not optionally.

**Before any non-trivial action:**
- \`recall(query="...")\` — check prior decisions and what has already been tried
- \`search_code(query="...")\` — discover code by meaning/concept

**After every bug fix, discovery, or resolved question — call remember() immediately:**
- \`remember(content="...", memory_type="episodic", tags="area,type", importance=0.8)\`
- Always include \`Files: src/path/to/file.ts\` in episodic content for path-based recall

**Respect memory statuses:**
- \`resolved\` — closed decision, do not reopen without new information
- \`open_question\` — treat as current agenda
- \`in_progress\` — actively being worked on
- \`hypothesis\` — proposed direction, not yet validated

All memory queries and content must be in English.`;

export async function runHookSessionStart(): Promise<void> {
  // Read stdin (Claude Code sends hook body) but we don't need it — just inject the static message.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

  // Use hookSpecificOutput.additionalContext — that's the field Claude Code injects into
  // the model's context for SessionStart. The top-level `systemMessage` is a UI-only banner
  // (shown to the user) and is *not* seen by the model — which is why prior session-start
  // messages appeared to be ignored by the agent.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:     "SessionStart",
      additionalContext: SESSION_START_MESSAGE,
    },
  }));
}
