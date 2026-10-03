"""LangChain + Agentropolis MCP + x402.

    python langchain_example.py            # search + manifest + 402 quote (dry run, no wallet needed)
    python langchain_example.py --free     # try the kit's free daily allowance (Seenly kits)
    python langchain_example.py --pay      # pay with BUYER_PRIVATE_KEY (capped by MAX_PAYMENT_USD)
    python langchain_example.py --agent    # also let an LLM agent use the MCP tools (needs OPENAI_API_KEY)
"""
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient

from agentropolis_pay import AGENT, KIT_ID, MCP_URL, QUERY, as_json, plan, print_search, quote_free_pay


async def main() -> int:
    client = MultiServerMCPClient({"agentropolis": {"transport": "streamable_http", "url": MCP_URL}})
    tools = {t.name: t for t in await client.get_tools()}
    print(f"Connected to {MCP_URL}: {len(tools)} LangChain tools ({', '.join(tools)})")

    found = as_json(await tools["search_kits"].ainvoke({"q": QUERY, "rail": "x402", "limit": 5}))
    print_search(found)
    manifest = as_json(await tools["get_kit_manifest"].ainvoke({"id": KIT_ID}))
    p = plan(manifest)
    print(f"\nget_kit_manifest({KIT_ID}) -> {p['method']} {p['url']}")
    code = await quote_free_pay(p)

    if AGENT:
        from langchain.agents import create_agent

        agent = create_agent("openai:gpt-5-mini", list(tools.values()))
        out = await agent.ainvoke({"messages": [{"role": "user", "content": f"Find a pay-per-call API for: {QUERY}. Compare price and payment-verified trust, then recommend one."}]})
        print("\nAgent:\n" + out["messages"][-1].content)
    return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
