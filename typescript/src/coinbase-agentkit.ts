/**
 * Coinbase AgentKit + Agentropolis MCP + x402.
 * AgentKit's x402 action provider pays from an AgentKit wallet (here a ViemWalletProvider built from
 * BUYER_PRIVATE_KEY, your own wallet). Agentropolis is used for discovery: search_kits + get_kit_manifest.
 *   npm run agentkit              # search + manifest + AgentKit make_http_request → 402 options (no payment)
 *   npm run agentkit -- --pay     # AgentKit retry_http_request_with_x402 (refuses anything above MAX_PAYMENT_USD)
 */
import { createMCPClient } from '@ai-sdk/mcp';
import { AgentKit, ViemWalletProvider, x402ActionProvider } from '@coinbase/agentkit';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { buyerKey, CONFIG, FLAGS, plan, short, toolJson, type Manifest, type ToolResult } from './agentropolis';

// AgentKit sends best-effort usage analytics to Coinbase (wallet address, network, action names) without
// awaiting them; when that endpoint rejects, Node would crash on the unhandled rejection. Ignore only those.
process.on('unhandledRejection', (e) => {
  if (e instanceof Error && e.stack?.includes('sendAnalyticsEvent')) return;
  throw e;
});

const chain = CONFIG.network === 'eip155:84532' ? baseSepolia : base;

// --- discovery through the Agentropolis MCP server
const mcp = await createMCPClient({ transport: { type: 'http', url: CONFIG.mcpUrl } });
let p: ReturnType<typeof plan>;
try {
  const tools = await mcp.tools();
  const call = async (name: string, args: Record<string, unknown>) =>
    toolJson((await tools[name].execute!(args, { toolCallId: name, messages: [], context: {} } as never)) as ToolResult);
  const found = await call('search_kits', { q: CONFIG.query, rail: 'x402', limit: 5 });
  console.log(`search_kits("${CONFIG.query}") → ${found.total} matches; top: ${(found.results ?? []).slice(0, 3).map((r: any) => r.id).join(', ')}`);
  const m = (await call('get_kit_manifest', { id: CONFIG.kitId })) as Manifest;
  p = plan(m);
  console.log(`get_kit_manifest(${CONFIG.kitId}) → ${p.method} ${p.url}`);
} finally {
  await mcp.close();
}

// --- AgentKit wallet + x402 actions
const account = privateKeyToAccount(buyerKey());
// AgentKit pins its own viem copy; the cast bridges the identical runtime WalletClient type.
const walletProvider = new ViemWalletProvider(createWalletClient({ account, chain, transport: http() }) as never);
const agentkit = await AgentKit.from({ walletProvider, actionProviders: [x402ActionProvider()] });
const action = (suffix: string) => {
  const a = agentkit.getActions().find((x) => x.name.endsWith(suffix));
  if (!a) throw new Error(`AgentKit action ${suffix} not found`);
  return a;
};
console.log(`AgentKit wallet ${account.address} on ${chain.name}; actions: ${agentkit.getActions().map((a) => a.name).join(', ')}`);

const req = { url: p.url, method: 'POST' as const, body: p.body as Record<string, unknown> };
const first = JSON.parse(await action('make_http_request').invoke(req));
if (first.status !== 'error_402_payment_required') {
  console.log(`No 402 (status ${first.status}): ${short(first)}`);
  process.exit(0);
}
const option = (first.acceptablePaymentOptions as any[]).find((o) => o.network === CONFIG.network);
if (!option) throw new Error(`No payment option on ${CONFIG.network}: ${short(first.acceptablePaymentOptions)}`);
const usd = Number(option.amount ?? option.maxAmountRequired) / 1e6;
console.log(`402: ${usd} USDC on ${option.network} → ${option.payTo}. Bazaar metadata: ${first.discoveryInfo?.extensions?.bazaar ? 'yes' : 'no'}`);
if (usd > CONFIG.maxPaymentUsd) throw new Error(`Refusing: ${usd} USDC is above MAX_PAYMENT_USD=${CONFIG.maxPaymentUsd}`);
if (!FLAGS.pay) {
  console.log('Dry run: add --pay to let AgentKit sign the payment.');
  process.exit(0);
}
const paid = JSON.parse(await action('retry_http_request_with_x402').invoke({ ...req, selectedPaymentOption: option }));
console.log(`Paid call: ${paid.status}; proof ${short(paid.details?.paymentProof ?? null, 300)}\n${short(paid.data, 400)}`);
if (paid.status !== 'success') process.exitCode = 1;
