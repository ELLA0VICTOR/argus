// Sentinel HTTP server (Node built-ins only).
// v1 routes in this build: health and the "steal my wallet" demo.
// The full client API is specified in docs/SENTINEL-API.md.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PROGRAM_ID } from "./chain.ts";
import { createSession, DemoError, demoPublic, ensureMint, prepareAttack, startWatcher, submitAttack, subscribe, type AttackKind } from "./demo.ts";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim());

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, message: string) {
  json(res, status, { error: { code, message } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000) throw new DemoError(413, "Request too large.");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DemoError(400, "Body must be JSON.");
  }
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["v1", ...]

  try {
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(res, 200, { ok: true, cluster: "devnet", program_id: PROGRAM_ID.toBase58(), ai_guardian: demoPublic.ai, version: "0.1.0" });
    }

    if (parts[0] === "v1" && parts[1] === "demo") {
      // POST /v1/demo/session
      if (req.method === "POST" && parts[2] === "session" && parts.length === 3) {
        return json(res, 201, await createSession(clientIp(req)));
      }
      const id = parts[2];
      // GET /v1/demo/:id/events  (Server-Sent Events)
      if (req.method === "GET" && parts[3] === "events" && parts.length === 4) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": connected\n\n");
        const unsub = subscribe(id, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
        if (!unsub) {
          res.write(`data: ${JSON.stringify({ t: Date.now(), type: "log", text: "This demo has expired. Start a new one.", tone: "threat" })}\n\n`);
          return res.end();
        }
        const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
        req.on("close", () => {
          clearInterval(ping);
          unsub();
        });
        return;
      }
      // POST /v1/demo/:id/attack                 { kind }
      // POST /v1/demo/:id/attack/:nonce          { signature }
      if (req.method === "POST" && parts[3] === "attack") {
        const body = await readJson(req);
        if (parts.length === 4) return json(res, 200, await prepareAttack(id, String(body.kind) as AttackKind));
        if (parts.length === 5) return json(res, 200, await submitAttack(id, parts[4], String(body.signature ?? "")));
      }
    }

    fail(res, 404, "NOT_FOUND", "No such route.");
  } catch (e) {
    if (e instanceof DemoError) return fail(res, e.status, "DEMO_ERROR", e.message);
    console.error("[sentinel] error:", (e as Error).message);
    fail(res, 500, "INTERNAL", "Something went wrong. Please try again.");
  }
});

await ensureMint();
startWatcher();
server.listen(PORT, () => {
  console.log(`[sentinel] listening on :${PORT}  program ${PROGRAM_ID.toBase58()}  ai ${demoPublic.ai}`);
});
