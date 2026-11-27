// Sentinel as a long-lived local server. The routes are in handler.ts; on
// Vercel the same handler runs as a function (vercel.ts).
import { createServer } from "node:http";
import { PROGRAM_ID } from "./chain.ts";
import { demoPublic } from "./demo.ts";
import { ensureSchema } from "./db.ts";
import { handle } from "./handler.ts";

const PORT = Number(process.env.PORT ?? 8787);

await ensureSchema();
createServer(handle).listen(PORT, () => {
  console.log(`[sentinel] listening on :${PORT}  program ${PROGRAM_ID.toBase58()}  ai ${demoPublic.ai}`);
});
