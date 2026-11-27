// Sentinel's HTTP routes, shared by the local server (server.ts) and the
// Vercel function (vercel.ts). v1 routes in this build: health and the
// "steal my wallet" demo. The full client API is in docs/SENTINEL-API.md.
import type { IncomingMessage, ServerResponse } from "node:http";
import { PROGRAM_ID } from "./chain.ts";
import { createSession, decide, DemoError, demoPublic, eventsAfter, load, phoneReady, prepareAttack, relayCall, submitAttack, tick, type AttackKind } from "./demo.ts";

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

// Behind a host's proxy (Vercel, Render…) every request comes from the
// proxy. TRUST_PROXY_HOPS=1 reads the address that proxy appended to
// X-Forwarded-For. Entries further left are client-supplied and can be faked,
// so they're never used. With 0 (local), the header is ignored.
const PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 0);

function clientIp(req: IncomingMessage): string {
  if (PROXY_HOPS > 0) {
    const raw = req.headers["x-forwarded-for"];
    const list = (Array.isArray(raw) ? raw.join(",") : (raw ?? "")).split(",").map((x) => x.trim()).filter(Boolean);
    const ip = list[list.length - PROXY_HOPS];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || "unknown";
}

// An event stream stays open this long, then closes; the browser reconnects
// with Last-Event-ID and carries on. Short on serverless (function time
// limits), effectively unlimited on a long-lived server.
const STREAM_MS = Number(process.env.STREAM_SECS ?? (process.env.VERCEL ? 50 : 3600)) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET /v1/demo/:id/events: Server-Sent Events, read from the database. */
async function stream(req: IncomingMessage, res: ServerResponse, id: string, after: number) {
  try {
    await load(id);
  } catch {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.write(`data: ${JSON.stringify({ t: Date.now(), type: "log", text: "This demo has expired. Start a new one.", tone: "threat" })}\n\n`);
    return void res.end();
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 1000\n\n");
  let closed = false;
  req.on("close", () => (closed = true));
  let cursor = after;
  let lastWrite = Date.now();
  const end = Date.now() + STREAM_MS;
  while (!closed && Date.now() < end) {
    try {
      await tick(id);
      const rows = await eventsAfter(id, cursor);
      for (const r of rows) {
        res.write(`id: ${r.id}\ndata: ${JSON.stringify(r.event)}\n\n`);
        cursor = r.id;
      }
      if (rows.length) lastWrite = Date.now();
      if (Date.now() - lastWrite > 15_000) {
        res.write(": ping\n\n");
        lastWrite = Date.now();
      }
      if (rows.length === 200) continue;
    } catch (e) {
      console.error("[sentinel] stream:", (e as Error).message);
    }
    await sleep(700);
  }
  res.end();
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
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
        const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        return await stream(req, res, id, Number.isSafeInteger(last) && last > 0 ? last : 0);
      }
      // POST /v1/demo/:id/decision  { decision: "cancel" | "allow", via: "voice" | "button" }
      if (req.method === "POST" && parts[3] === "decision" && parts.length === 4) {
        const body = await readJson(req);
        const d = body.decision === "allow" ? "allow" : body.decision === "cancel" ? "cancel" : null;
        if (!d) throw new DemoError(400, "decision must be cancel or allow");
        return json(res, 200, await decide(id, d, body.via === "voice" ? "voice" : "button"));
      }
      // POST /v1/demo/:id/phone   (a phone joined as the owner's device)
      if (req.method === "POST" && parts[3] === "phone" && parts.length === 4) {
        return json(res, 200, await phoneReady(id));
      }
      // POST /v1/demo/:id/call    { status?: "connected" | "ended", who?: "argus" | "owner", text? }
      if (req.method === "POST" && parts[3] === "call" && parts.length === 4) {
        return json(res, 200, await relayCall(id, await readJson(req)));
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
    if (!res.headersSent) fail(res, 500, "INTERNAL", "Something went wrong. Please try again.");
  }
}

