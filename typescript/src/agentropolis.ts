/**
 * Shared helpers for the TypeScript examples: config, Agentropolis MCP tool calls, and x402 payment
 * with YOUR OWN wallet. Agentropolis never holds keys or funds; you pay the seller directly.
 */
import 'dotenv/config';
import { x402Client, type PaymentPolicy } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';

export const CONFIG = {
  mcpUrl: process.env.AGENTROPOLIS_MCP_URL || 'https://agentropolis.io/api/mcp',
  query: process.env.SEARCH_QUERY || 'token honeypot check on Base',
  kitId: process.env.KIT_ID || 'seenly.seenly-token-preflight',
  kitInput: process.env.KIT_INPUT_JSON ? (JSON.parse(process.env.KIT_INPUT_JSON) as unknown) : undefined,
  endpointOverride: process.env.KIT_ENDPOINT_OVERRIDE || undefined, // e.g. a local testnet copy of a kit
  network: process.env.X402_NETWORK || 'eip155:8453', // Base mainnet; eip155:84532 = Base Sepolia (testnet)
  maxPaymentUsd: Number(process.env.MAX_PAYMENT_USD || '0.05'),
};

export const FLAGS = {
  pay: process.argv.includes('--pay'), // sign and pay (otherwise: dry run, shows the 402 quote only)
  free: process.argv.includes('--free'), // try the kit's free daily allowance first (Seenly kits)
  agent: process.argv.includes('--agent'), // also run an LLM agent loop (needs a model key)
};

export function buyerKey(): `0x${string}` {
  const k = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('Set BUYER_PRIVATE_KEY (0x + 64 hex) in .env: your own wallet holding a little USDC on the chosen network. Never commit it.');
  return k as `0x${string}`;
}

/** Minimal structural type for an MCP tool result. */
export type ToolResult = { structuredContent?: unknown; content?: { type: string; text?: string }[]; isError?: boolean };
export const toolJson = <T = any>(r: ToolResult): T => {
  if (r.structuredContent) return r.structuredContent as T;
  const t = r.content?.find((c) => c.type === 'text')?.text ?? '{}';
  try { return JSON.parse(t) as T; } catch { throw new Error(`Tool returned non-JSON: ${t.slice(0, 200)}`); }
};

export interface Manifest {
  id: string; name: string;
  invoke: { kind: string; method?: string; url: string }[];
  sample?: { input?: unknown };
  offers?: { rail: string; network: string; amount: string; price_usd: string; payTo: string; asset_address?: string }[];
}

/** Pick the HTTP endpoint + body to call from a kit manifest (get_kit_manifest). */
export function plan(m: Manifest) {
  const http = m.invoke.find((i) => i.kind === 'http' && (i.method ?? 'POST') === 'POST') ?? m.invoke.find((i) => i.kind === 'http');
  if (!http) throw new Error(`Kit ${m.id} has no HTTP invoke entry`);
  const offer = m.offers?.find((o) => o.rail === 'x402');
  const url = CONFIG.endpointOverride ?? http.url;
  const body = CONFIG.kitInput ?? m.sample?.input;
  if (!body) throw new Error('This kit has no sample input; set KIT_INPUT_JSON.');
  return { url, method: http.method ?? 'POST', body, offer };
}

/** USD → USDC base units (6 decimals). */
const usdUnits = (usd: number) => BigInt(Math.round(usd * 1e6));

/** Unpaid request: returns the seller's 402 quote (nothing is signed). */
export async function quote(url: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const pr = r.headers.get('payment-required');
  const json = (await r.json().catch(() => null)) as any;
  if (r.status !== 402 || !pr) return { status: r.status, json, requirements: null };
  const req = decodePaymentRequiredHeader(pr);
  return { status: 402, json, requirements: req };
}

/** Paid request with your wallet: refuses any requirement above MAX_PAYMENT_USD or on another network. */
export async function payAndCall(url: string, body: unknown) {
  const account = privateKeyToAccount(buyerKey());
  const cap = usdUnits(CONFIG.maxPaymentUsd);
  const guard: PaymentPolicy = (_v, reqs) => reqs.filter((r) => r.network === CONFIG.network && BigInt(r.amount) <= cap);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account, policies: [guard] });
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const r = await paidFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const pr = r.headers.get('payment-response');
  let json = (await r.json().catch(() => null)) as any;
  const again = r.status === 402 ? r.headers.get('payment-required') : null;
  if (again) json = { payment_rejected: decodePaymentRequiredHeader(again).error, body: json }; // e.g. unfunded wallet
  return { status: r.status, payer: account.address, settlement: pr ? decodePaymentResponseHeader(pr) : null, json };
}

export const short = (v: unknown, n = 600) => { const s = JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };
