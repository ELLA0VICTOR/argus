import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, type Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import type { Challenge } from '../sentinel/types';
import { signatureFromSignedPayload } from '../sentinel/rules';

export type WalletSession = { address: string; authToken: string };
const walletIdentity = { name: 'Argus', uri: 'https://tryargus.vercel.app', icon: 'favicon.svg' };

export async function connectWallet(): Promise<WalletSession> {
  if (Platform.OS !== 'android') throw new Error('Wallet connection requires an Android development build.');
  return transact(async wallet => {
    const result = await wallet.authorize({ chain: 'solana:devnet', identity: walletIdentity });
    const account = result.accounts[0];
    if (!account) throw new Error('The wallet did not authorize an account.');
    return {
      address: new PublicKey(Buffer.from(account.address, 'base64')).toBase58(),
      authToken: result.auth_token,
    };
  });
}

export async function disconnectWallet(session: WalletSession): Promise<void> {
  await transact(async wallet => { await wallet.deauthorize({ auth_token: session.authToken }); });
}

export async function signSentinelChallenge(session: WalletSession, challenge: Challenge): Promise<string> {
  return transact(async wallet => {
    const authorization = await wallet.authorize({ chain: 'solana:devnet', identity: walletIdentity, auth_token: session.authToken });
    session.authToken = authorization.auth_token;
    const account = authorization.accounts.find(a => new PublicKey(Buffer.from(a.address, 'base64')).toBase58() === session.address);
    if (!account) throw new Error('The wallet account changed. Reconnect and sign in again.');
    const message = new TextEncoder().encode(challenge.message);
    const payloads = await wallet.signMessages({ addresses: [account.address], payloads: [message] });
    if (payloads.length !== 1) throw new Error('The wallet did not return the requested sign-in signature.');
    return signatureFromSignedPayload(payloads[0], message, session.address);
  });
}

/** Sign only the caller's exact displayable message; return the signature+message for local verification. */
export async function signWalletMessage(session: WalletSession, message: Uint8Array): Promise<Uint8Array> {
  if (Platform.OS !== 'android') throw new Error('Message signing requires Android.');
  return transact(async wallet => {
    const authorization = await wallet.authorize({ chain: 'solana:devnet', identity: walletIdentity, auth_token: session.authToken });
    session.authToken = authorization.auth_token;
    const account = authorization.accounts.find(a => new PublicKey(Buffer.from(a.address, 'base64')).toBase58() === session.address);
    if (!account) throw new Error('The wallet account changed. Reconnect before signing.');
    const result = await wallet.signMessages({ addresses: [account.address], payloads: [message] });
    if (result.length !== 1) throw new Error('The wallet did not return the requested signature.');
    signatureFromSignedPayload(result[0], message, session.address);
    return result[0];
  });
}

export function validateVaultAddress(value: string): string {
  try { return new PublicKey(value.trim()).toBase58(); }
  catch { throw new Error('Enter a valid Solana vault account address.'); }
}

export async function signWalletTransaction(session: WalletSession, transaction: Transaction): Promise<Transaction> {
  if (Platform.OS !== 'android') throw new Error('Wallet transactions require an Android development build.');
  return transact(async wallet => {
    const authorization = await wallet.authorize({ chain: 'solana:devnet',
      identity: walletIdentity, auth_token: session.authToken });
    session.authToken = authorization.auth_token;
    const match = authorization.accounts.some(a => new PublicKey(Buffer.from(a.address, 'base64')).toBase58() === session.address);
    if (!match) throw new Error('The wallet account changed. Reconnect before signing.');
    const [signed] = await wallet.signTransactions({ transactions: [transaction] });
    if (!signed) throw new Error('The wallet did not sign the transaction.');
    return signed;
  });
}
