"""Same call as the README "Pay Guard ($0.01) — Python" snippet. Run ONE of them: every paid run is one
separate $0.01 charge (running the snippet and this file back to back = two charges).

    python python/quickstart_pay_guard.py          # dry run: shows the 402 price, signs nothing
    python python/quickstart_pay_guard.py --pay    # pays once from BUYER_PRIVATE_KEY, prints the one settlement tx
"""
import asyncio, base64, json, os, re, sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from eth_account import Account
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact.register import register_exact_evm_client
from x402.mechanisms.evm.signers import EthAccountSigner

# Load repo-root .env if present; never commit that file.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

URL = "https://seenly-pay-guard.vercel.app/api/guard"
BODY = {
    "domain": "seenly-payload-check.vercel.app",
    "max_price_usd": 0.05,
    "challenge": {
        "payTo": "0xeE6239F3E17bEBe5e89F21F29D74D68CAa0d78CE",
        "amount": "30000",
        "network": "eip155:8453",
        "resource": "https://seenly-payload-check.vercel.app/api/check",
    },
}

if "--pay" not in sys.argv:
    r = httpx.post(URL, json=BODY, timeout=60)
    pr = r.headers.get("payment-required", "")
    a = json.loads(base64.b64decode(pr + "=" * (-len(pr) % 4)))["accepts"][0] if pr else {}
    print(r.status_code, f"quote: {int(a.get('amount', 0)) / 1e6} USDC on {a.get('network')}")
    print("Dry run: nothing signed. Add --pay to pay once from BUYER_PRIVATE_KEY.")
    sys.exit(0)

key = os.environ.get("BUYER_PRIVATE_KEY", "").strip()
if not re.fullmatch(r"0x[0-9a-fA-F]{64}", key):
    raise SystemExit("Set BUYER_PRIVATE_KEY (0x + 64 hex) in .env. Never commit it.")

CAP = 50_000  # $0.05 USDC, 6 decimals
client = x402Client()
register_exact_evm_client(
    client,
    EthAccountSigner(Account.from_key(key)),
    policies=[lambda _v, reqs: [r for r in reqs if r.network == "eip155:8453" and int(r.get_amount()) <= CAP]],
)

async def main():
    async with x402HttpxClient(client, timeout=120) as http:
        r = await http.post(URL, json=BODY)  # one call = one signed payment = one settlement
        print(r.status_code, r.json())
        receipt = r.headers.get("payment-response")
        if receipt:
            tx = json.loads(base64.b64decode(receipt + "=" * (-len(receipt) % 4))).get("transaction")
            print("Paid once. Settlement tx:", tx)

asyncio.run(main())
