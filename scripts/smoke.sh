#!/usr/bin/env bash
# Smoke test: every example connects to the Agentropolis MCP server, searches, reads a kit manifest and
# gets the seller's x402 402 quote. Dry run only: nothing is signed or paid, no wallet needed.
set -euo pipefail
cd "$(dirname "$0")/.."
unset BUYER_PRIVATE_KEY KIT_ENDPOINT_OVERRIDE
PY=${PYTHON:-python3}
fail=0
run() { local name=$1; shift; if out=$("$@" 2>&1) && grep -q "402 quote:" <<<"$out" && grep -q "Bazaar metadata: yes" <<<"$out"; then echo "PASS $name"; else echo "FAIL $name"; echo "$out" | tail -20; fail=1; fi; }
run "Vercel AI SDK"      bash -c "cd typescript && npx tsx src/vercel-ai-sdk.ts"
run "LangChain"          bash -c "cd python && $PY langchain_example.py"
run "CrewAI"             bash -c "cd python && $PY crewai_example.py"
run "OpenAI Agents SDK"  bash -c "cd python && $PY openai_agents_example.py"
# AgentKit needs a wallet to build its wallet provider: use a throwaway random key (never funded, never pays).
KEY=0x$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
if out=$(cd typescript && BUYER_PRIVATE_KEY=$KEY npx tsx src/coinbase-agentkit.ts 2>&1) && grep -q "^402:" <<<"$out" && grep -q "Bazaar metadata: yes" <<<"$out"; then echo "PASS Coinbase AgentKit"; else echo "FAIL Coinbase AgentKit"; echo "$out" | tail -20; fail=1; fi
exit $fail
