"""CrewAI + Agentropolis MCP + x402.

    python crewai_example.py            # search + manifest + 402 quote (dry run, no wallet needed)
    python crewai_example.py --free     # try the kit's free daily allowance (Seenly kits)
    python crewai_example.py --pay      # pay with BUYER_PRIVATE_KEY (capped by MAX_PAYMENT_USD)
    python crewai_example.py --agent    # also run a one-agent Crew with the MCP tools (needs OPENAI_API_KEY)
"""
import asyncio

from crewai_tools import MCPServerAdapter

from agentropolis_pay import AGENT, KIT_ID, MCP_URL, QUERY, as_json, plan, print_search, quote_free_pay


def main() -> int:
    with MCPServerAdapter({"url": MCP_URL, "transport": "streamable-http"}) as mcp_tools:
        tools = {t.name: t for t in mcp_tools}
        print(f"Connected to {MCP_URL}: {len(tools)} CrewAI tools ({', '.join(tools)})")

        found = as_json(tools["search_kits"].run(q=QUERY, rail="x402", limit=5))
        print_search(found)
        manifest = as_json(tools["get_kit_manifest"].run(id=KIT_ID))
        p = plan(manifest)
        print(f"\nget_kit_manifest({KIT_ID}) -> {p['method']} {p['url']}")
        code = asyncio.run(quote_free_pay(p))

        if AGENT:
            from crewai import Agent, Crew, Task

            scout = Agent(role="Tool scout", goal="Find the right paid API for a task", backstory="Checks price and payment-verified trust before recommending a tool.", tools=list(tools.values()))
            task = Task(description=f"Find a pay-per-call API for: {QUERY}. Recommend one with price and trust.", expected_output="One recommendation with id, price and trust.", agent=scout)
            print("\nCrew:\n" + str(Crew(agents=[scout], tasks=[task]).kickoff()))
        return code


if __name__ == "__main__":
    raise SystemExit(main())
