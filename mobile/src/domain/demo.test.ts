import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countdown, createDemo, demoReducer } from './demo.ts';

test('countdown handles subsecond boundaries, expiry, and long delays', () => {
  assert.equal(countdown(1, 0), '00:00:01');
  assert.equal(countdown(0, 1), 'Ready to execute');
  assert.equal(countdown(90_061_000, 0), '25:01:01');
});

test('cancel and freeze are idempotent and keep unrelated requests intact', () => {
  const state = createDemo(0);
  const cancelled = demoReducer(state, { type: 'cancel', id: 'WD-0042', now: 1 });
  assert.equal(cancelled.withdrawals[0].status, 'cancelled');
  assert.equal(cancelled.withdrawals[1].status, 'pending');
  assert.equal(demoReducer(cancelled, { type: 'cancel', id: 'WD-0042', now: 2 }), cancelled);
  const frozen = demoReducer(cancelled, { type: 'freeze', now: 3 });
  assert.equal(frozen.frozen, true);
  assert.equal(demoReducer(frozen, { type: 'freeze', now: 4 }), frozen);
});

test('a guardian cannot vote twice or approve a vetoed proposal', () => {
  const state = createDemo(0);
  const approved = demoReducer(state, { type: 'approve', id: 'GP-0007', now: 1 });
  assert.equal(approved.proposals[0].approvals, 2);
  assert.equal(approved.proposals[0].unlocksAt, state.proposals[0].unlocksAt);
  assert.equal(demoReducer(approved, { type: 'approve', id: 'GP-0007', now: 2 }), approved);
  assert.equal(demoReducer(approved, { type: 'veto', id: 'GP-0007', now: 3 }).proposals[0].decision, 'vetoed');
  const vetoed = demoReducer(state, { type: 'veto', id: 'GP-0007', now: 1 });
  assert.equal(demoReducer(vetoed, { type: 'approve', id: 'GP-0007', now: 2 }), vetoed);
});
