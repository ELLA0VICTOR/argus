import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ARGUS_ERRORS, UNKNOWN_TRANSACTION_MESSAGE, argusErrorForCode, transactionErrorMessage } from './errors.ts';
import { RESERVED_PROGRAM_ID } from '../sentinel/rules.ts';

const OTHER_PROGRAM = '11111111111111111111111111111111';
const invoke = (program: string, depth = 1) => `Program ${program} invoke [${depth}]`;
const fail = (program: string, code: number) => `Program ${program} failed: custom program error: 0x${code.toString(16)}`;

test('every code and name matches the append-only Rust enum, without using the starter IDL', () => {
  const source = readFileSync(new URL('../../../programs/argus/src/error.rs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/^\s{4}([A-Za-z]\w*),\s*(?:\/\/.*)?$/gm)].map(match => match[1]);
  assert.equal(names.length, 34);
  assert.deepEqual(Object.keys(ARGUS_ERRORS).map(Number), names.map((_, i) => 6000 + i));
  names.forEach((name, i) => {
    const mapped = argusErrorForCode(6000 + i);
    assert.equal(mapped?.name, name);
    assert.ok(mapped!.message.length > 0 && mapped!.message.length < 90);
  });
});

test('known codes cover role, safe-address and token policy failures; unknown codes do not alias', () => {
  assert.equal(argusErrorForCode(6001)?.name, 'NotOwner');
  assert.equal(argusErrorForCode(6024)?.name, 'InvalidSafeAddress');
  assert.equal(argusErrorForCode(6025)?.message, 'Use a classic SPL Token mint.');
  assert.equal(argusErrorForCode(6027)?.name, 'InvalidAmount');
  assert.equal(argusErrorForCode(6028)?.name, 'InvalidDestination');
  assert.equal(argusErrorForCode(6031)?.name, 'TrustedAccountMismatch');
  assert.equal(argusErrorForCode(6032)?.name, 'ProposalExpired');
  assert.equal(argusErrorForCode(6033)?.name, 'ProposalStillLive');
  for (const code of [2040, 5999, 6034, -32002, NaN, Infinity, 6000.5]) assert.equal(argusErrorForCode(code), undefined);
});

test('Anchor errors need Argus provenance and retain their exact code-name pairing', () => {
  const error = { error: { errorCode: { number: 6001, code: 'NotOwner' } } };
  assert.equal(transactionErrorMessage(error, [RESERVED_PROGRAM_ID]), ARGUS_ERRORS[6001].message);
  assert.equal(transactionErrorMessage({ ...error, program: { toBase58: () => RESERVED_PROGRAM_ID } }), ARGUS_ERRORS[6001].message);
  assert.equal(transactionErrorMessage(error), UNKNOWN_TRANSACTION_MESSAGE);
  assert.equal(transactionErrorMessage({ ...error, program: OTHER_PROGRAM }, [RESERVED_PROGRAM_ID]), UNKNOWN_TRANSACTION_MESSAGE);
  assert.equal(transactionErrorMessage({ error: { errorCode: { number: 6001, code: 'NotGuardian' } } }, [RESERVED_PROGRAM_ID]), UNKNOWN_TRANSACTION_MESSAGE);
});

test('RPC confirmation and preflight errors use the failing instruction program, not a JSON-RPC code', () => {
  const status = { InstructionError: [1, { Custom: 6010 }] };
  for (const error of [{ err: status }, { value: { err: status } }, { code: -32002, data: { err: status } }, status]) {
    assert.equal(transactionErrorMessage(error, [OTHER_PROGRAM, RESERVED_PROGRAM_ID]), ARGUS_ERRORS[6010].message);
    assert.equal(transactionErrorMessage(error, [RESERVED_PROGRAM_ID, OTHER_PROGRAM]), UNKNOWN_TRANSACTION_MESSAGE);
    assert.equal(transactionErrorMessage(error), UNKNOWN_TRANSACTION_MESSAGE);
  }
  assert.equal(transactionErrorMessage({ code: 6000, message: 'This is not a program code.' }), UNKNOWN_TRANSACTION_MESSAGE);
  for (const code of [6027, 6028]) {
    assert.equal(transactionErrorMessage({ err: { InstructionError: [0, { Custom: code }] } }, [RESERVED_PROGRAM_ID]), argusErrorForCode(code)!.message);
  }
});

test('web3.js log errors decode hex codes and distinguish CPI failures from Argus failures', () => {
  const logs = [invoke(RESERVED_PROGRAM_ID), fail(RESERVED_PROGRAM_ID, 6025)];
  assert.equal(transactionErrorMessage({ logs }), ARGUS_ERRORS[6025].message);
  assert.equal(transactionErrorMessage({ transactionError: { logs, message: 'Simulation failed' } }), ARGUS_ERRORS[6025].message);
  const cpi = [invoke(RESERVED_PROGRAM_ID), invoke(OTHER_PROGRAM, 2), fail(OTHER_PROGRAM, 6000), fail(RESERVED_PROGRAM_ID, 6000)];
  assert.equal(transactionErrorMessage({ logs: cpi, err: { InstructionError: [0, { Custom: 6000 }] } }, [RESERVED_PROGRAM_ID]), UNKNOWN_TRANSACTION_MESSAGE);
  const caughtThenAnotherInstruction = [invoke(OTHER_PROGRAM), fail(OTHER_PROGRAM, 6000), invoke(RESERVED_PROGRAM_ID), fail(RESERVED_PROGRAM_ID, 6002)];
  assert.equal(transactionErrorMessage({ logs: caughtThenAnotherInstruction }), ARGUS_ERRORS[6002].message);
});

test('unknown, wallet, transport, malformed and future program errors use a status-check fallback', () => {
  for (const error of [undefined, null, '0x1770', new Error('offline'), { logs: [null, 4, 'unrelated'] },
    { logs: [invoke(RESERVED_PROGRAM_ID), fail(RESERVED_PROGRAM_ID, 6032)] }, { err: { InstructionError: [0, 'InvalidAccountData'] } }]) {
    assert.equal(transactionErrorMessage(error, [RESERVED_PROGRAM_ID]), UNKNOWN_TRANSACTION_MESSAGE);
  }
});
