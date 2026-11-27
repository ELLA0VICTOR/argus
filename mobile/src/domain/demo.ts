export type Withdrawal = {
  id: string;
  amount: string;
  destination: string;
  unlocksAt: number;
  flagged: boolean;
  reasons: string[];
  status: 'pending' | 'cancelled';
};

export type Proposal = {
  id: string;
  title: string;
  description: string;
  approvals: number;
  threshold: number;
  unlocksAt: number;
  decision: 'open' | 'approved' | 'vetoed';
};

export type DemoState = {
  frozen: boolean;
  withdrawals: Withdrawal[];
  proposals: Proposal[];
  log: { id: number; at: number; message: string }[];
};

export type DemoAction =
  | { type: 'cancel'; id: string; now: number }
  | { type: 'freeze'; now: number }
  | { type: 'approve' | 'veto'; id: string; now: number }
  | { type: 'reset'; now: number };

export function createDemo(now: number): DemoState {
  return {
    frozen: false,
    withdrawals: [
      {
        id: 'WD-0042', amount: '680.00', destination: '9WzD…AwfM',
        unlocksAt: now + 85_267_000, flagged: true,
        reasons: ['Address created 3 minutes ago', 'Named in 2 public drainer reports'],
        status: 'pending',
      },
      {
        id: 'WD-0041', amount: '125.00', destination: '7tRb…Kp2n',
        unlocksAt: now + 7_320_000, flagged: false,
        reasons: ['Outside the daily instant allowance'], status: 'pending',
      },
    ],
    proposals: [{
      id: 'GP-0007', title: 'Add a trusted address',
      description: 'Allow instant transfers to 4pRv…8cQm.',
      approvals: 1, threshold: 2, unlocksAt: now + 86_400_000, decision: 'open',
    }],
    log: [
      { id: 2, at: now, message: 'Sentinel flagged WD-0042 for review.' },
      { id: 1, at: now - 60_000, message: 'Withdrawal WD-0042 entered the delay.' },
    ],
  };
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'reset') return createDemo(action.now);
  let message: string;
  let next = state;
  if (action.type === 'cancel') {
    if (!state.withdrawals.some(w => w.id === action.id && w.status === 'pending')) return state;
    next = { ...state, withdrawals: state.withdrawals.map(w => w.id === action.id ? { ...w, status: 'cancelled' } : w) };
    message = `${action.id} cancelled. Funds stay in the vault.`;
  } else if (action.type === 'freeze') {
    if (state.frozen) return state;
    next = { ...state, frozen: true };
    message = 'Vault frozen. Outgoing transfers are paused.';
  } else {
    if (!state.proposals.some(p => p.id === action.id &&
      (action.type === 'approve' ? p.decision === 'open' : p.decision !== 'vetoed'))) return state;
    next = {
      ...state,
      proposals: state.proposals.map(p => p.id === action.id ? {
        ...p, approvals: p.approvals + (action.type === 'approve' ? 1 : 0),
        decision: action.type === 'approve' ? 'approved' : 'vetoed',
      } : p),
    };
    message = action.type === 'approve' ? `${action.id}: your approval recorded. The delay still applies.` : `${action.id} vetoed.`;
  }
  return { ...next, log: [{ id: state.log[0].id + 1, at: action.now, message }, ...state.log] };
}

export function countdown(unlocksAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((unlocksAt - now) / 1000));
  if (total === 0) return 'Ready to execute';
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
