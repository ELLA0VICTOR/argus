// Chain access for Sentinel: connection, the Argus program client (from the same
// IDL the apps use), PDA helpers and error decoding.
import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import idlJson from "../../app/src/idl/argus.json" with { type: "json" };

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

// The IDL is the one the web app ships (app/src/idl), bundled in at build time.
export const idl = idlJson as unknown as Idl & {
  address: string;
  errors: { code: number; name: string; msg: string }[];
};
export const PROGRAM_ID = new PublicKey(idl.address);

/** Read-only-ish Anchor client. We sign and send transactions ourselves. */
function walletFor(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
}
export function programFor(kp: Keypair) {
  const provider = new AnchorProvider(connection, walletFor(kp) as never, { commitment: "confirmed" });
  return new Program(idl, provider);
}

type AccountClient = {
  fetch: (address: PublicKey) => Promise<any>;
  all: (filters?: unknown[]) => Promise<{ publicKey: PublicKey; account: any }[]>;
};
/** Typed access to `program.account.<name>` for the generic IDL. */
export function accounts(kp: Keypair): Record<"vault" | "withdrawal" | "proposal" | "trustedAddress", AccountClient> {
  return programFor(kp).account as unknown as Record<"vault" | "withdrawal" | "proposal" | "trustedAddress", AccountClient>;
}

const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const pda = {
  vault: (creator: PublicKey, id: number | bigint = 0) => PublicKey.findProgramAddressSync([Buffer.from("vault"), creator.toBuffer(), u64le(id)], PROGRAM_ID)[0],
  withdrawal: (vault: PublicKey, id: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from("withdrawal"), vault.toBuffer(), u64le(id)], PROGRAM_ID)[0],
  trusted: (vault: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("trusted"), vault.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0],
};

export { BN };

/** Human message for an Argus error code (6000+), or null. */
export function argusError(code: number): { code: number; name: string; msg: string } | null {
  const e = idl.errors.find((x) => x.code === code);
  return e ? { code: e.code, name: e.name, msg: e.msg ?? e.name } : null;
}

/** Pulls a custom program error code out of logs or an error string. */
export function errorCodeFrom(e: unknown, logs?: string[] | null): number | null {
  const text = [String((e as Error)?.message ?? e), ...(logs ?? [])].join("\n");
  const anchor = text.match(/Error Number: (\d+)/);
  if (anchor) return Number(anchor[1]);
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) return parseInt(hex[1], 16);
  return null;
}

/** Signs with `signers` (fee payer first) and sends, confirming. */
export async function sendIxs(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}
