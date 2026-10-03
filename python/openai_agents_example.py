"""OpenAI Agents SDK + Agentropolis MCP + x402.

    python openai_agents_example.py            # search + manifest + 402 quote (dry run, no wallet needed)
    python openai_agents_example.py --free     # try the kit's free daily allowance (Seenly kits)
    python openai_agents_example.py --pay      # pay with BUYER_PRIVATE_KEY (capped by MAX_PAYMENT_USD)
    python openai_agents_example.py --agent    # also run an Agent over the MCP server (needs OPENAI_API_KEY)
"""
import asyncio

from agents.mcp import MCPServerStreamableHttp

from agentropolis_pay import AGENT, KIT_ID, MCP_URL, QUERY, as_json, plan, print_search, quote_free_pay


async def main() -> int:
    async with MCPServerStreamableHttp(name="agentropolis", params={"url": MCP_URL, "timeout": 30}, cache_tools_list=True) as server:
        tools = await server.list_tools()
        print(f"Connected to {MCP_URL}: {len(tools)} tools ({', '.join(t.name for t in tools)})")

        found = as_json(await server.call_tool("search_kits", {"q": QUERY, "rail": "x402", "limit": 5}))
        print_search(found)
        manifest = as_json(await server.call_tool("get_kit_manifest", {"id": KIT_ID}))
        p = plan(manifest)
        print(f"\nget_kit_manifest({KIT_ID}) -> {p['method']} {p['url']}")
        code = await quote_free_pay(p)

        if AGENT:
            from agents import Agent, Runner

            agent = Agent(name="Tool scout", instructions="Find tools for the user's task. Compare price and payment-verified trust.", mcp_servers=[server])
            result = await Runner.run(agent, f"Find a pay-per-call API for: {QUERY}")
            print("\nAgent:\n" + str(result.final_output))
        return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
