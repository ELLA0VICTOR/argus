// Sentinel as a long-lived local server. The routes are in handler.ts; on
// Vercel the same handler runs as a function (vercel.ts).
import { createServer } from "node:http";
import { PROGRAM_ID } from "./chain.ts";
import { demoPublic } from "./demo.ts";
import { ensureSchema } from "./db.ts";
import { handle } from "./handler.ts";
import { scanVault, watchedVaults } from "./watch.ts";

const PORT = Number(process.env.PORT ?? 8787);

await ensureSchema();

// A long-lived server can poll. (On Vercel, the Helius webhook does this job.)
if (process.env.WATCH_LOOP !== "0") {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const v of await watchedVaults()) await scanVault(v);
    } catch (e) {
      console.error("[sentinel] watch loop:", (e as Error).message);
    } finally {
      busy = false;
    }
  }, 10_000);
}
createServer(handle).listen(PORT, () => {
  console.log(`[sentinel] listening on :${PORT}  program ${PROGRAM_ID.toBase58()}  ai ${demoPublic.ai}`);
});
