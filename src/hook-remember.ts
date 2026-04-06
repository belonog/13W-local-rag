import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";

export async function runHookRemember(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) { process.stdout.write("{}"); return; }

  const localCfg = await readLocalConfig(defaultLocalConfigPath()).catch(() => null);
  const port      = localCfg?.port ?? 7531;
  const serverUrl = process.env["MEMORY_SERVER_URL"] ?? `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${serverUrl}/hooks/remember`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) { process.stdout.write("{}"); return; }
    const data = await res.text();
    process.stdout.write(data);
  } catch {
    process.stdout.write("{}");
  }
}
