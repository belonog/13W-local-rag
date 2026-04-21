export async function init(): Promise<void> {
  process.stderr.write(
    `[init] DEPRECATED: local-rag init is no longer needed.\n` +
    `[init] Install the plugin instead:\n` +
    `[init]   claude plugin install @13w/local-rag\n` +
    `[init] For Gemini CLI:\n` +
    `[init]   gemini extensions install https://github.com/13w/local-rag\n` +
    `[init] See README for migration steps from v1.\n`
  );
  process.exit(0);
}
