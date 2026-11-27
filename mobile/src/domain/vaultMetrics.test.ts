import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allowanceRemaining, allowanceFraction, waitFraction, delayLabel, sendRoute } from './vaultMetrics.ts';

test('allowance resets exactly at the window boundary and clamps after a limit reduction', () => {
  assert.equal(allowanceRemaining(100n, 70n, 1_000n, 87_399n), 30n);
  assert.equal(allowanceRemaining(100n, 70n, 1_000n, 87_400n), 100n);
  assert.equal(allowanceRemaining(50n, 70n, 1_000n, 1_001n), 0n);
  assert.equal(allowanceRemaining(0n, 0n, 1_000n, 1_001n), 0n);
});

test('Send derives the web route at the allowance boundary without rounding large amounts', () => {
  const allowance = (1n << 53n) + 3n;
  assert.equal(sendRoute(allowance, allowance, false, true), 'instant');
  assert.equal(sendRoute(allowance + 1n, allowance, false, true), 'delayed');
  assert.equal(sendRoute(allowance + 1n, 0n, true, true), 'trusted');
  assert.equal(sendRoute(0n, allowance, true, true), null);
  assert.equal(sendRoute(1n, allowance, true, false), null);
});

test('allowance calculations preserve u64 precision and have a bounded zero-safe meter', () => {
  const limit = (1n << 64n) - 1n;
  assert.equal(allowanceRemaining(limit, limit - 1n, 0n, 1n), 1n);
  assert.equal(allowanceFraction(0n, 0n), 0);
  assert.equal(allowanceFraction(limit, limit), 1);
  assert.equal(allowanceFraction(limit + 1n, limit), 1);
  assert.equal(allowanceFraction(limit / 2n, limit), 0.4999);
});

test('wait progress uses each request timestamp, including future, mature and zero-length waits', () => {
  assert.equal(waitFraction(100, 300, 0), 0);
  assert.equal(waitFraction(100, 300, 200), 0.5);
  assert.equal(waitFraction(100, 300, 400), 1);
  assert.equal(waitFraction(100, 100, 100), 1);
  assert.equal(delayLabel(86_400n), '24h');
  assert.equal(delayLabel(172_800n), '2d');
  assert.equal(delayLabel(90n), '90s');
});
