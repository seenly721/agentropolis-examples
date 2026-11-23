// Same call as the README "Token Verdict ($0.02) — Node" snippet. Run ONE of them: every paid run is one
// separate $0.02 charge (running the snippet and this file back to back = two charges).
//   npm run quickstart-token-verdict            # dry run: shows the 402 price, signs nothing
//   npm run quickstart-token-verdict -- --pay   # pays once from BUYER_PRIVATE_KEY and prints the one settlement tx
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../.env"), quiet: true }); // repo-root .env (git-ignored)
loadEnv({ quiet: true }); // also accept typescript/.env
import { x402Client, type PaymentPolicy } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const URL = "https://seenly-token-preflight.vercel.app/api/token-preflight";
const init: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chain: "base",
    tokenAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN, a public example
  }),
};

if (!process.argv.includes("--pay")) {
  const quote = await fetch(URL, init);
  const pr = quote.headers.get("payment-required");
  const a = pr ? (JSON.parse(Buffer.from(pr, "base64").toString()) as { accepts: { amount: string; network: string }[] }).accepts[0] : undefined;
  console.log(quote.status, a ? `quote: ${Number(a.amount) / 1e6} USDC on ${a.network}` : "no x402 quote");
  console.log("Dry run: nothing signed. Add --pay to pay once from BUYER_PRIVATE_KEY.");
  process.exit(0);
}

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

const res = await paidFetch(URL, init); // one call = one signed payment = one settlement
const receipt = res.headers.get("payment-response");
console.log(res.status, await res.json());
if (receipt) console.log("Paid once. Settlement tx:", decodePaymentResponseHeader(receipt).transaction);
