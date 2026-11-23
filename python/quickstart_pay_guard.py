import asyncio, os, re
from pathlib import Path

from dotenv import load_dotenv
from eth_account import Account
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact.register import register_exact_evm_client
from x402.mechanisms.evm.signers import EthAccountSigner

# Load repo-root .env if present; never commit that file.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

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
        r = await http.post(
            "https://seenly-pay-guard.vercel.app/api/guard",
            json={
                "domain": "seenly-payload-check.vercel.app",
                "max_price_usd": 0.05,
                "challenge": {
                    "payTo": "0xeE6239F3E17bEBe5e89F21F29D74D68CAa0d78CE",
                    "amount": "30000",
                    "network": "eip155:8453",
                    "resource": "https://seenly-payload-check.vercel.app/api/check",
                },
            },
        )
        print(r.status_code, r.json())

asyncio.run(main())
