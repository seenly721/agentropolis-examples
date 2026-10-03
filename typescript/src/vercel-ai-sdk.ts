/**
 * Vercel AI SDK + Agentropolis MCP + x402.
 *   npm run ai-sdk                 # search + manifest + 402 quote (dry run, no wallet needed)
 *   npm run ai-sdk -- --free       # try the kit's free daily allowance (Seenly kits)
 *   npm run ai-sdk -- --pay        # pay with BUYER_PRIVATE_KEY (capped by MAX_PAYMENT_USD)
 *   npm run ai-sdk -- --agent      # also let an LLM use the MCP tools (needs OPENAI_API_KEY or AI_GATEWAY_API_KEY)
 */
import { createMCPClient } from '@ai-sdk/mcp';
import { generateText, stepCountIs } from 'ai';
import { CONFIG, FLAGS, payAndCall, plan, quote, short, toolJson, type Manifest, type ToolResult } from './agentropolis';

const mcp = await createMCPClient({ transport: { type: 'http', url: CONFIG.mcpUrl } });
try {
  const tools = await mcp.tools();
  console.log(`Connected to ${CONFIG.mcpUrl}: ${Object.keys(tools).length} tools (${Object.keys(tools).join(', ')})`);
  const call = async (name: string, args: Record<string, unknown>) =>
    toolJson((await tools[name].execute!(args, { toolCallId: name, messages: [], context: {} } as never)) as ToolResult);

  // 1) Search
  const found = await call('search_kits', { q: CONFIG.query, rail: 'x402', limit: 5 });
  console.log(`\nsearch_kits("${CONFIG.query}") → ${found.total} matches. Top results:`);
  for (const r of found.results ?? []) console.log(`  - ${r.id}  ${r.pricing?.min_usd != null ? `$${r.pricing.min_usd}` : ''}  trust=${r.trust?.score ?? 'n/a'}  ${r.name}`);
  for (const r of found.featured_first_party ?? []) console.log(`  * featured (first-party): ${r.id}  ${r.name}`);

  // 2) Manifest for the kit we want to buy
  const m = await call('get_kit_manifest', { id: CONFIG.kitId }) as Manifest;
  const p = plan(m);
  console.log(`\nget_kit_manifest(${CONFIG.kitId}) → ${p.method} ${p.url}  offer: ${p.offer ? `$${p.offer.price_usd} USDC on ${p.offer.network} to ${p.offer.payTo}` : 'none'}`);

  // 3) Quote (unpaid) / free / paid
  if (FLAGS.free) {
    const r = await quote(p.url, p.body, { 'X-Free-Allowance': 'use' });
    console.log(r.status === 200 ? `\nFree call OK: ${short(r.json?.free_allowance)}\n${short(r.json, 400)}` : `\nNo free call (${r.json?.free_allowance?.status ?? r.status}); normal x402 price applies.`);
  }
  const q = await quote(p.url, p.body);
  if (q.requirements) {
    const a = q.requirements.accepts[0];
    console.log(`\n402 quote: ${a.amount} base units (${Number(a.amount) / 1e6} USDC) on ${a.network} → payTo ${a.payTo}. Bazaar metadata: ${q.requirements.extensions && 'bazaar' in q.requirements.extensions ? 'yes' : 'no'}`);
  } else console.log(`\nUnpaid request returned ${q.status} (no 402).`);
  if (FLAGS.pay) {
    const r = await payAndCall(p.url, p.body).catch((e: Error) => {
      console.error(`\nPayment refused or failed: ${e.message}`);
      process.exit(1);
    });
    console.log(`\nPaid call → HTTP ${r.status}; payer ${r.payer}; settlement ${r.settlement?.transaction ?? 'none'} (${r.settlement?.network ?? ''})\n${short(r.json, 500)}`);
    if (r.status !== 200) process.exitCode = 1;
  } else console.log('\nDry run: add --pay to sign the payment with BUYER_PRIVATE_KEY.');

  // 4) Optional LLM agent loop over the same MCP tools
  if (FLAGS.agent) {
    const model = process.env.AI_MODEL || 'openai/gpt-5-mini';
    const { text } = await generateText({ model, tools, stopWhen: stepCountIs(5), prompt: `Find a pay-per-call API for: ${CONFIG.query}. Compare price and payment-verified trust, then recommend one.` });
    console.log(`\nAgent (${model}):\n${text}`);
  }
} finally {
  await mcp.close();
}
