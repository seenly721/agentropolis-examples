"""Shared helpers for the Python examples: config, kit manifest planning, and x402 payment with YOUR OWN wallet.

Agentropolis never holds keys or funds: you pay the seller's payTo directly, the seller's facilitator settles.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

MCP_URL = os.getenv("AGENTROPOLIS_MCP_URL", "https://agentropolis.io/api/mcp")
QUERY = os.getenv("SEARCH_QUERY", "token honeypot check on Base")
KIT_ID = os.getenv("KIT_ID", "seenly.seenly-token-preflight")
KIT_INPUT = json.loads(os.environ["KIT_INPUT_JSON"]) if os.getenv("KIT_INPUT_JSON") else None
ENDPOINT_OVERRIDE = os.getenv("KIT_ENDPOINT_OVERRIDE") or None  # e.g. a local testnet copy of a kit
NETWORK = os.getenv("X402_NETWORK", "eip155:8453")  # Base mainnet; eip155:84532 = Base Sepolia (testnet)
MAX_PAYMENT_USD = float(os.getenv("MAX_PAYMENT_USD", "0.05"))

PAY = "--pay" in sys.argv  # sign and pay (otherwise: dry run, shows the 402 quote only)
FREE = "--free" in sys.argv  # try the kit's free daily allowance first (Seenly kits)
AGENT = "--agent" in sys.argv  # also run an LLM agent loop (needs OPENAI_API_KEY)


def buyer_key() -> str:
    k = (os.getenv("BUYER_PRIVATE_KEY") or "").strip()
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", k):
        raise SystemExit("Set BUYER_PRIVATE_KEY (0x + 64 hex) in .env: your own wallet with a little USDC on the chosen network. Never commit it.")
    return k


def as_json(result: Any) -> Any:
    """Turn an MCP tool result (dict, JSON string, content blocks, CallToolResult) into JSON."""
    if isinstance(result, (dict, list)) and not (isinstance(result, list) and result and isinstance(result[0], dict) and "type" in result[0]):
        return result
    sc = getattr(result, "structuredContent", None)
    if sc:
        return sc
    content = getattr(result, "content", None)
    if content is None and isinstance(result, tuple):
        content = result[0]
    if content is None:
        content = result
    if isinstance(content, list):
        texts = [c.get("text") if isinstance(c, dict) else getattr(c, "text", None) for c in content]
        content = next((t for t in texts if t), "{}")
    if not isinstance(content, str):
        return content
    try:
        return json.loads(content)
    except ValueError:
        raise SystemExit(f"MCP tool returned an error: {content[:300]}") from None


def plan(manifest: dict) -> dict:
    """Pick the HTTP endpoint and request body from a kit manifest (get_kit_manifest)."""
    invoke = manifest.get("invoke", [])
    http = next((i for i in invoke if i.get("kind") == "http" and i.get("method", "POST") == "POST"), None) or next((i for i in invoke if i.get("kind") == "http"), None)
    if not http:
        raise SystemExit(f"Kit {manifest.get('id')} has no HTTP invoke entry")
    body = KIT_INPUT if KIT_INPUT is not None else (manifest.get("sample") or {}).get("input")
    if body is None:
        raise SystemExit("This kit has no sample input; set KIT_INPUT_JSON.")
    offer = next((o for o in manifest.get("offers", []) if o.get("rail") == "x402"), None)
    return {"url": ENDPOINT_OVERRIDE or http["url"], "method": http.get("method", "POST"), "body": body, "offer": offer}


def _b64json(v: str) -> dict:
    return json.loads(base64.b64decode(v + "=" * (-len(v) % 4)))


def quote(url: str, body: Any, headers: dict | None = None) -> dict:
    """Unpaid request: returns the seller's 402 requirements (nothing is signed)."""
    r = httpx.post(url, json=body, headers=headers or {}, timeout=90)
    pr = r.headers.get("payment-required")
    try:
        data = r.json()
    except ValueError:
        data = None
    return {"status": r.status_code, "json": data, "requirements": _b64json(pr) if r.status_code == 402 and pr else None}


async def pay_and_call(url: str, body: Any) -> dict:
    """Paid request with your wallet. Refuses requirements above MAX_PAYMENT_USD or on another network."""
    from eth_account import Account
    from x402 import x402Client
    from x402.http.clients import x402HttpxClient
    from x402.mechanisms.evm.exact.register import register_exact_evm_client
    from x402.mechanisms.evm.signers import EthAccountSigner

    account = Account.from_key(buyer_key())
    cap = round(MAX_PAYMENT_USD * 1_000_000)

    def guard(_version, reqs):
        return [r for r in reqs if r.network == NETWORK and int(r.get_amount()) <= cap]

    client = x402Client()
    register_exact_evm_client(client, EthAccountSigner(account), policies=[guard])
    async with x402HttpxClient(client, timeout=120) as http:
        r = await http.post(url, json=body)
        pr = r.headers.get("payment-response")
        try:
            data = r.json()
        except ValueError:
            data = r.text[:500]
        if r.status_code == 402 and r.headers.get("payment-required"):
            data = {"payment_rejected": _b64json(r.headers["payment-required"]).get("error"), "body": data}
        return {"status": r.status_code, "payer": account.address, "settlement": _b64json(pr) if pr else None, "json": data}


def short(v: Any, n: int = 600) -> str:
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + "…"


async def quote_free_pay(p: dict) -> int:
    """Shared tail of every example: optional free call, the 402 quote, and the optional paid call."""
    if FREE:
        r = quote(p["url"], p["body"], {"X-Free-Allowance": "use"})
        fa = (r["json"] or {}).get("free_allowance") or {}
        print(f"\nFree call OK: {short(fa)}" if r["status"] == 200 else f"\nNo free call ({fa.get('status', r['status'])}); normal x402 price applies.")
    q = quote(p["url"], p["body"])
    if q["requirements"]:
        a = q["requirements"]["accepts"][0]
        has_bazaar = "bazaar" in (q["requirements"].get("extensions") or {})
        print(f"\n402 quote: {a['amount']} base units ({int(a['amount']) / 1e6} USDC) on {a['network']} -> payTo {a['payTo']}. Bazaar metadata: {'yes' if has_bazaar else 'no'}")
    else:
        print(f"\nUnpaid request returned {q['status']} (no 402).")
    if not PAY:
        print("\nDry run: add --pay to sign the payment with BUYER_PRIVATE_KEY.")
        return 0
    try:
        r = await pay_and_call(p["url"], p["body"])
    except Exception as e:  # policy refusal, unfunded wallet, network error
        print(f"\nPayment refused or failed: {e}")
        return 1
    s = r["settlement"] or {}
    print(f"\nPaid call -> HTTP {r['status']}; payer {r['payer']}; settlement {s.get('transaction', 'none')} ({s.get('network', '')})\n{short(r['json'], 500)}")
    return 0 if r["status"] == 200 else 1


def print_search(found: dict) -> None:
    print(f"\nsearch_kits({QUERY!r}) -> {found.get('total')} matches. Top results:")
    for r in found.get("results", []):
        price = (r.get("pricing") or {}).get("min_usd")
        print(f"  - {r['id']}  {'$' + str(price) if price is not None else ''}  trust={(r.get('trust') or {}).get('score')}  {r['name']}")
    for r in found.get("featured_first_party", []):
        print(f"  * featured (first-party): {r['id']}  {r['name']}")
