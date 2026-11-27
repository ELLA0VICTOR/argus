// Solana libraries expect Node's Buffer as a global. Import this first.
import { Buffer } from "buffer";

if (!(globalThis as { Buffer?: unknown }).Buffer) (globalThis as { Buffer?: unknown }).Buffer = Buffer;
