/* Launch-source detection. Evidence order: factory address → bytecode fingerprint → default.
   source ∈ pons_v2_curve | pons_v2_grad | pons_v1 | hoodfun | pools_trade | direct */
import { createHash } from "node:crypto";
import { explorer } from "./blockscout.js";

const env = (k) => (process.env[k] || "").toLowerCase() || null;
const FACTORIES = () => ({
  [env("PONS_V2_FACTORY")]: "pons_v2",
  [env("PONS_V1_FACTORY")]: "pons_v1",
  [env("HOODFUN_FACTORY")]: "hoodfun",
  [env("POOLS_TRADE_FACTORY")]: "pools_trade",
});
export const fingerprint = (bytecode) => createHash("sha256").update(bytecode || "").digest("hex").slice(0, 16);

export async function detectSource(addr, db) {
  const info = await explorer.address(addr);
  const creator = info?.creator_address_hash?.toLowerCase() || null;
  const creationTx = info?.creation_tx_hash || null;
  const known = creator ? FACTORIES()[creator] : null;
  let source = "direct", evidence = "no launchpad factory matched", verified = null, fp = null;

  const code = await explorer.contractCode(addr);
  verified = code?.is_verified ?? null;
  fp = fingerprint(code?.deployed_bytecode);

  if (known) { source = known; evidence = `created by ${known} factory`; }
  else if (db) {
    const row = await db.query("select platform from fingerprints where fp=$1", [fp]);
    if (row.rows[0]) { source = row.rows[0].platform; evidence = `bytecode fingerprint ${fp}`; }
  }
  if (source === "pons_v2") source = (await hasGraduated(addr)) ? "pons_v2_grad" : "pons_v2_curve";
  return { source, evidence, creator, creationTx, verified, fp, mintable: /mint\(/i.test(code?.source_code || "") };
}

/* Graduation = liquidity moved to the v4 pool manager. Replace with an event read once the ABI is wired. */
async function hasGraduated(addr) {
  const pm = env("UNISWAP_V4_POOL_MANAGER");
  if (!pm) return false;
  const transfers = await explorer.transfers(addr, 3);
  return transfers.some(t => t.to?.hash?.toLowerCase() === pm);
}
