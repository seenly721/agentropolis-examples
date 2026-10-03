# Agentropolis examples: find and pay for agent tools with MCP + x402

[![MCP server](https://img.shields.io/badge/MCP-agentropolis.io%2Fapi%2Fmcp-5b5bd6)](https://agentropolis.io/install)
[![x402](https://img.shields.io/badge/payments-x402%20(USDC%20on%20Base)-0052ff)](https://www.x402.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![smoke](https://github.com/seenly721/agentropolis-examples/actions/workflows/smoke.yml/badge.svg)](https://github.com/seenly721/agentropolis-examples/actions/workflows/smoke.yml)

Kits used in the examples:
[![Token Preflight on Agentropolis](https://agentropolis.io/badge/seenly.seenly-token-preflight.svg)](https://agentropolis.io/listing/seenly.seenly-token-preflight)
[![Transcript+ on Agentropolis](https://agentropolis.io/badge/seenly.seenly-transcript-plus.svg)](https://agentropolis.io/listing/seenly.seenly-transcript-plus)
[![Pitch Kit on Agentropolis](https://agentropolis.io/badge/seenly.seenly-pitch-kit.svg)](https://agentropolis.io/listing/seenly.seenly-pitch-kit)

[Agentropolis](https://agentropolis.io) is a free, no-auth search engine for agent tools: MCP servers,
x402 and MPP pay-per-call APIs, A2A agents and "kits". Its trust scores come only from verified,
non-wash on-chain payments.

Each example here does the same four things with a different agent framework:

1. Connects to the Agentropolis MCP server at `https://agentropolis.io/api/mcp` through the framework's own MCP adapter.
2. Calls `search_kits` to find tools for a task.
3. Calls `get_kit_manifest` to learn how to call the chosen kit: endpoint, sample input and x402 offer.
4. Pays the seller directly with x402, using **your own wallet**. The key comes from an env var.

| Framework | File | MCP adapter | Payment |
|---|---|---|---|
| Vercel AI SDK (TypeScript) | [`typescript/src/vercel-ai-sdk.ts`](typescript/src/vercel-ai-sdk.ts) | `@ai-sdk/mcp` | `@x402/fetch` |
| Coinbase AgentKit (TypeScript) | [`typescript/src/coinbase-agentkit.ts`](typescript/src/coinbase-agentkit.ts) | `@ai-sdk/mcp` (discovery) | AgentKit `x402ActionProvider` |
| LangChain (Python) | [`python/langchain_example.py`](python/langchain_example.py) | `langchain-mcp-adapters` | `x402` (Python) |
| CrewAI (Python) | [`python/crewai_example.py`](python/crewai_example.py) | `crewai-tools[mcp]` `MCPServerAdapter` | `x402` (Python) |
| OpenAI Agents SDK (Python) | [`python/openai_agents_example.py`](python/openai_agents_example.py) | `agents.mcp.MCPServerStreamableHttp` | `x402` (Python) |

## Safety first

- **No real keys in this repo, ever.** Put `BUYER_PRIVATE_KEY` in `.env`, which is git-ignored. Use a dedicated hot wallet holding only a few dollars of USDC.
- **Dry run by default.** Without `--pay`, the examples only show the seller's 402 quote. Nothing is signed.
- **Spend cap.** Every payment goes through a client policy that refuses any requirement above `MAX_PAYMENT_USD` (default `0.05`) or on another network than `X402_NETWORK`.
- **Non-custodial.** Agentropolis never holds keys or funds and never pays for you. You pay the seller's `payTo`, the seller's facilitator settles, and settlement happens only after a successful response.
- **The LLM does not hold your wallet.** The `--agent` mode lets a model use the read-only MCP tools to research. Payments stay in plain code behind the cap.

## Quick start

```bash
git clone https://github.com/seenly721/agentropolis-examples && cd agentropolis-examples
cp .env.example .env            # add BUYER_PRIVATE_KEY only when you want to pay

# TypeScript (Node 20+)
cd typescript && npm install
npm run ai-sdk                  # search + manifest + 402 quote (no wallet needed)
npm run ai-sdk -- --free        # use a free daily call on a Seenly kit (no wallet needed)
npm run ai-sdk -- --pay         # pay $0.02 USDC on Base from YOUR wallet
npm run agentkit -- --pay       # same with Coinbase AgentKit's x402 actions
cd ..

# Python (3.10+)
python -m venv .venv && . .venv/bin/activate
pip install -r python/requirements.txt
cd python
python langchain_example.py [--free] [--pay] [--agent]
python crewai_example.py [--free] [--pay] [--agent]
python openai_agents_example.py [--free] [--pay] [--agent]
```

Sample output (dry run):

```
Connected to https://agentropolis.io/api/mcp: 10 tools (search_kits, get_kit, get_kit_manifest, call_kit, ...)

search_kits("token honeypot check on Base") -> 526 matches. Top results:
  - x402.token-safety-check-x402  $0.03  trust=54  Token Safety Check (x402)
  ...
  * featured (first-party): seenly.seenly-token-preflight  Token Preflight — Base pre-trade token check

get_kit_manifest(seenly.seenly-token-preflight) -> POST https://seenly-token-preflight.vercel.app/api/token-preflight

402 quote: 20000 base units (0.02 USDC) on eip155:8453 -> payTo 0xeE62…78CE. Bazaar metadata: yes

Dry run: add --pay to sign the payment with BUYER_PRIVATE_KEY.
```

`--agent` also runs an LLM loop over the same MCP tools. It needs a model key: `OPENAI_API_KEY`, or for the AI SDK, `AI_GATEWAY_API_KEY`.

## Choosing what to buy

`KIT_ID` defaults to `seenly.seenly-token-preflight`, a $0.02 Base token safety check. Disclosure: it is a
first-party kit by Seenly, which is affiliated with Agentropolis. Agentropolis labels first-party kits as
"featured" and never mixes them into organic results.

To buy something else, set `KIT_ID` to any id from `search_kits`. Set `KIT_INPUT_JSON` if its manifest has
no sample input. Always trust the seller's live 402 over any listed price.

## Free daily allowance (Seenly kits)

Token Preflight, Transcript+ and Pitch Kit each give a few free calls per day. A request opts in with the
header `X-Free-Allowance: use`; the `--free` flag sends it.

- Each caller network (IPv4 /24 or IPv6 /64) gets 3 free calls per UTC day on each kit.
- Each kit also has a global daily cap.
- Transcript+ free calls cover audio up to 2 minutes.

After that the same request returns the normal x402 402. Free calls are never counted as sales or trust.
Details are in each kit's `llms.txt` and in <https://agentropolis.io/llms.txt>.

## Testing without real money

Run any kit locally in test mode (Base Sepolia, x402.org facilitator) and point the examples at it:

```bash
export X402_NETWORK=eip155:84532 KIT_ENDPOINT_OVERRIDE=http://localhost:3412/api/token-preflight
export BUYER_PRIVATE_KEY=0x...   # a testnet wallet with Base Sepolia USDC (faucet.circle.com)
npm run ai-sdk -- --pay          # or any Python example with --pay
```

These examples were tested this way. Each of the five completed a Base Sepolia x402 payment, and the spend
cap refused over-budget quotes. `scripts/smoke.sh` runs on every push and weekly. It does the
connect/search/manifest/quote path against production and never pays.

## Notes

- **x402 v2:** sellers answer with a `PAYMENT-REQUIRED` header. Clients retry with `PAYMENT-SIGNATURE` and get `PAYMENT-RESPONSE`, which carries the settlement tx hash. Payers need USDC only, no ETH.
- **Bazaar:** Seenly kits include Coinbase x402 Bazaar discovery metadata (`extensions.bazaar`) in their 402s.
- **AgentKit telemetry:** Coinbase AgentKit sends usage analytics to Coinbase, including the wallet address and action names. The example ignores failures of that call so they cannot crash your run.
- **Relay:** Agentropolis also offers a non-custodial relay (`call_kit` MCP tool, `/api/v1/call/{id}`) for listings marked `buy: relay_x402`. The examples pay sellers directly, which is simpler and does not depend on Agentropolis being up.

## Links

- Install the MCP server in Cursor, VS Code or Claude Code: <https://agentropolis.io/install>
- Agent docs: <https://agentropolis.io/llms.txt>
- Badges and tiers: <https://agentropolis.io/badges>
- Contact: hello@agentropolis.io

MIT licensed. See [LICENSE](LICENSE).
