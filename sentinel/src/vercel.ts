// Sentinel as a Vercel function. scripts/build-vercel.mjs bundles this file
// into .vercel/output (Build Output API). Every request goes to handle().
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "./handler.ts";

export default function (req: IncomingMessage, res: ServerResponse) {
  return handle(req, res);
}
