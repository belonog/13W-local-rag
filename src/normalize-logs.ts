import { QdrantClient } from "@qdrant/js-client-rest";
import { readLocalConfig, defaultLocalConfigPath } from "./local-config.js";
import { colName, initQdrant, setCollectionPrefix } from "./qdrant.js";
import { loadServerConfig } from "./server-config.js";

async function run() {
  const localCfg = await readLocalConfig(defaultLocalConfigPath());
  const qdrantUrl = localCfg.qdrant?.url || "http://localhost:6333";
  const qdrantApiKey = localCfg.qdrant?.api_key || "";
  
  initQdrant(qdrantUrl, qdrantApiKey);
  const qd = new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey });
  
  // Load server config to get the collection prefix
  const serverConfig = await loadServerConfig(qd);
  if (serverConfig.collection_prefix) {
    setCollectionPrefix(serverConfig.collection_prefix);
  }

  const col = colName("request_logs");
  console.log(`Normalizing collection: ${col}`);
  
  let offset: string | number | undefined;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const result = await qd.scroll(col, {
      limit: 100,
      with_payload: true,
      with_vector: false,
      ...(offset !== undefined && { offset }),
    });

    for (const pt of result.points) {
      totalProcessed++;
      const p = (pt.payload ?? {}) as Record<string, any>;
      
      const isWatcher = p["source"] === "watcher";
      const tool = String(p["tool"] ?? "");
      const isFilePath = tool.includes("/") || tool.includes(".");
      
      if (isWatcher && (tool !== "indexer" || !p["file"])) {
        const originalTool = tool;
        const newFile = p["file"] || originalTool;
        
        await qd.setPayload(col, {
          payload: {
            tool: "indexer",
            file: newFile
          },
          points: [pt.id]
        });
        
        totalUpdated++;
        if (totalUpdated % 10 === 0) {
          console.log(`Updated ${totalUpdated}/${totalProcessed} points...`);
        }
      }
    }

    const next = (result as any).next_page_offset;
    if (!next) break;
    offset = next;
  }

  console.log(`Done. Processed ${totalProcessed} points, updated ${totalUpdated}.`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
