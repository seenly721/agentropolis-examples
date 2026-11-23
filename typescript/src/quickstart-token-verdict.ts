import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../.env") }); // repo-root .env (git-ignored)
loadEnv(); // also accept typescript/.env
import { x402Client, type PaymentPolicy } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const key = process.env.BUYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error("Set BUYER_PRIVATE_KEY (0x + 64 hex) in .env. Never commit it.");
}

const cap = 50_000n; // $0.05 USDC, 6 decimals
const guard: PaymentPolicy = (_v, reqs) =>
  reqs.filter((r) => r.network === "eip155:8453" && BigInt(r.amount) <= cap);

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`), policies: [guard] });
const paidFetch = wrapFetchWithPayment(fetch, client);

const res = await paidFetch("https://seenly-token-preflight.vercel.app/api/token-preflight", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chain: "base",
    tokenAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN, a public example
  }),
});
console.log(res.status, await res.json());
