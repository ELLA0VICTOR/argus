import { RESERVED_PROGRAM_ID } from '../sentinel/rules.ts';

// programs/argus/src/error.rs is append-only. No IDL layouts or transaction builders here.
export const ARGUS_ERRORS = {
  6000: { name: 'Frozen', message: 'The vault is frozen. Guardians must unfreeze it first.' },
  6001: { name: 'NotOwner', message: 'Connect the vault owner’s wallet.' },
  6002: { name: 'NotGuardian', message: 'This action needs a guardian wallet.' },
  6003: { name: 'NotAuthorizedRole', message: 'Your wallet cannot perform this action.' },
  6004: { name: 'OverDailyLimit', message: 'This exceeds the remaining daily allowance.' },
  6005: { name: 'NotTrusted', message: 'This destination is not a trusted address.' },
  6006: { name: 'TrustedNotActive', message: 'This trusted address is still waiting to activate.' },
  6007: { name: 'TooEarly', message: 'The withdrawal or proposal delay has not ended.' },
  6008: { name: 'StaleOwnerEpoch', message: 'The owner key changed. This withdrawal is invalid.' },
  6009: { name: 'StaleGuardianEpoch', message: 'The guardians changed. Create a new proposal.' },
  6010: { name: 'ThresholdNotMet', message: 'More guardian approvals are needed.' },
  6011: { name: 'AlreadyApproved', message: 'You have already approved this proposal.' },
  6012: { name: 'InvalidThreshold', message: 'Choose a threshold from 1 to the guardian count.' },
  6013: { name: 'DuplicateGuardian', message: 'Each guardian must use a different key.' },
  6014: { name: 'RoleOverlap', message: 'Use separate owner, guardian, and AI keys.' },
  6015: { name: 'DelayOutOfBounds', message: 'The delay is outside the allowed range.' },
  6016: { name: 'NotStricter', message: 'This change must tighten the current limits.' },
  6017: { name: 'MintMismatch', message: 'Choose a token account for the vault’s mint.' },
  6018: { name: 'InsufficientFunds', message: 'The vault does not have enough tokens.' },
  6019: { name: 'TooManyTrusted', message: 'The vault has reached its trusted-address limit.' },
  6020: { name: 'NotVetoable', message: 'This proposal cannot be vetoed.' },
  6021: { name: 'CannotVetoOwnRemoval', message: 'You cannot veto a proposal that removes you.' },
  6022: { name: 'InvalidGuardianCount', message: 'Choose between 1 and 5 guardians.' },
  6023: { name: 'InvalidGuardian', message: 'Choose a valid guardian wallet.' },
  6024: { name: 'InvalidSafeAddress', message: 'Choose a nonzero safe address separate from the vault, owner, and AI.' },
  6025: { name: 'UnsupportedMint', message: 'Use a classic SPL Token mint.' },
  6026: { name: 'MathOverflow', message: 'A value exceeds the program’s supported range.' },
  6027: { name: 'InvalidAmount', message: 'Enter an amount greater than zero.' },
  6028: { name: 'InvalidDestination', message: 'The destination cannot be the vault’s own token account.' },
  6029: { name: 'AlreadyTrusted', message: 'This wallet is already a trusted address.' },
  6030: { name: 'InvalidTrustedWallet', message: 'Choose a valid wallet to add as a trusted address.' },
  6031: { name: 'TrustedAccountMismatch', message: 'The trusted-address record does not match this proposal.' },
  6032: { name: 'ProposalExpired', message: 'This proposal expired before enough guardians approved it.' },
  6033: { name: 'ProposalStillLive', message: 'This proposal is still active and cannot be closed.' },
} as const;

export type ArgusErrorCode = keyof typeof ARGUS_ERRORS;
export type ArgusError = (typeof ARGUS_ERRORS)[ArgusErrorCode];
export const UNKNOWN_TRANSACTION_MESSAGE = 'Could not complete the transaction. Check its status before retrying.';

// Use this only with a code already identified as an Argus error (for example from the final IDL).
export function argusErrorForCode(code: number): ArgusError | undefined {
  return Number.isInteger(code) && Object.hasOwn(ARGUS_ERRORS, code) ? ARGUS_ERRORS[code as ArgusErrorCode] : undefined;
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' ? value as ObjectValue : {};
function programAddress(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const candidate = object(value);
  try { if (typeof candidate.toBase58 === 'function') return candidate.toBase58.call(value) as string; } catch { /* Unrecognized error shape. */ }
  return undefined;
}

/** Formats Anchor, RPC confirmation/preflight, and web3.js log errors.
 * instructionPrograms is the ordered list of program IDs from the submitted transaction.
 * It is required for a bare RPC Custom code, whose namespace is otherwise unknown.
 * Unknown errors and foreign program errors never borrow Argus messages by number.
 */
export function transactionErrorMessage(error: unknown, instructionPrograms: readonly string[] = []): string {
  const root = object(error);
  const data = object(root.data);
  const transaction = object(root.transactionError);
  const rawLogs = root.logs ?? data.logs ?? transaction.logs;
  const logs = Array.isArray(rawLogs) ? rawLogs.filter((line): line is string => typeof line === 'string') : [];

  // The first failure in the final invocation chain identifies a CPI error's namespace.
  let failedProgram: string | undefined;
  let failureCode: number | undefined;
  for (const line of logs) {
    if (/^Program \S+ invoke \[\d+\]$/.test(line) && failedProgram) { failedProgram = undefined; failureCode = undefined; }
    const failure = /^Program (\S+) failed: custom program error: (0x[0-9a-f]+|\d+)$/i.exec(line);
    if (failure && !failedProgram) { failedProgram = failure[1]; failureCode = Number(failure[2]); }
  }
  if (failedProgram && failedProgram !== RESERVED_PROGRAM_ID) return UNKNOWN_TRANSACTION_MESSAGE;

  const anchor = object(object(root.error).errorCode);
  const explicitProgram = programAddress(root.program);
  if (explicitProgram && explicitProgram !== RESERVED_PROGRAM_ID) return UNKNOWN_TRANSACTION_MESSAGE;
  if (typeof anchor.number === 'number') {
    const mapped = argusErrorForCode(anchor.number);
    const scoped = explicitProgram === RESERVED_PROGRAM_ID || failedProgram === RESERVED_PROGRAM_ID ||
      (instructionPrograms.length === 1 && instructionPrograms[0] === RESERVED_PROGRAM_ID);
    if (scoped && mapped && (anchor.code === undefined || anchor.code === mapped.name)) return mapped.message;
  }

  const status = object(root.err ?? object(root.value).err ?? data.err ?? error);
  const instructionError = status.InstructionError;
  if (Array.isArray(instructionError) && typeof instructionError[0] === 'number') {
    const custom = object(instructionError[1]).Custom;
    if (typeof custom === 'number' && instructionPrograms[instructionError[0]] === RESERVED_PROGRAM_ID) {
      return argusErrorForCode(custom)?.message ?? UNKNOWN_TRANSACTION_MESSAGE;
    }
  }
  if (failedProgram === RESERVED_PROGRAM_ID && failureCode !== undefined) return argusErrorForCode(failureCode)?.message ?? UNKNOWN_TRANSACTION_MESSAGE;
  return UNKNOWN_TRANSACTION_MESSAGE;
}
