/* GET /api/token/:address → everything the UI needs, in one object. */
import { explorer } from "../adapter/blockscout.js";
import { detectSource } from "../adapter/launchpad.js";
import { analyze } from "../scoring/analyze.js";
import { toCandles, sniperShare } from "../scoring/normalize.js";

const SOURCE_UNLOCKS = {
  pons_v2_curve: (t) => [{ h: 0, pct: 0, label: `Curve at ${Math.round((t.curvePct || 0) * 100)}% — graduation moves liquidity to a locked Uniswap v4 pool`, good: true },
    { h: 1, pct: Math.round(t.snipers * 70), label: "Expected first exit wave after graduation (curve snipers)", hot: true },
    { h: 24, pct: 2, label: "Creator buyback tranche vests" }, { h: 72, pct: 2, label: "Creator buyback tranche vests" }],
  pons_v2_grad: () => [{ h: 0, pct: 0, label: "Liquidity permanently locked at graduation", good: true }, { h: 12, pct: 2, label: "Creator buyback tranche vests" }, { h: 36, pct: 2, label: "Creator buyback tranche vests" }],
  pons_v1: () => [{ h: 0, pct: 0, label: "Liquidity permanently locked at launch", good: true }],
  hoodfun: () => [{ h: 0, pct: 0, label: "Launchpad-managed liquidity", good: true }],
  pools_trade: () => [{ h: 0, pct: 0, label: "Uniswap pool — verify lock on explorer", hot: true }],
  direct: (t) => [{ h: 0, pct: 0, label: t.lpLocked ? "LP locked" : "LP is not locked — can be pulled any time", hot: !t.lpLocked, good: t.lpLocked }],
};

export async function tokenReport(addr, db) {
  addr = addr.toLowerCase();
  const [info, src, holdersRaw, transfers] = await Promise.all([
    explorer.token(addr), detectSource(addr, db), explorer.holders(addr, 25), explorer.transfers(addr, 8),
  ]);
  if (!info) return null;

  // holders: prefer the indexed snapshot (has clusters); fall back to live
  let holders = [];
  if (db) holders = (await db.query("select wallet,pct,first_block,cluster,funded_by from holders where token=$1 order by pct desc", [addr])).rows;
  if (!holders.length) {
    const total = holdersRaw.reduce((a, h) => a + Number(h.value || 0), 0) || 1;
    holders = holdersRaw.map(h => ({ wallet: h.address.hash.toLowerCase(), pct: Number(h.value || 0) / total * 100, first_block: false, cluster: null }));
  }
  // swaps: indexed if present; else derive from transfers in/out of the pool (price unknown → skip zone)
  let swaps = db ? (await db.query("select extract(epoch from ts)*1000 ts, side, usd, price_usd, wallet from swaps where token=$1 order by ts", [addr])).rows.map(r => ({ ...r, ts: +r.ts, usd: +r.usd, price_usd: +r.price_usd, early: false })) : [];
  const early = new Set(holders.filter(h => h.first_block).map(h => h.wallet));
  swaps = swaps.map(s => ({ ...s, early: early.has(s.wallet) }));
  const candles = toCandles(swaps);

  const deployer = db && src.creator ? (await db.query("select * from deployers where address=$1", [src.creator])).rows[0] : null;
  const market = {
    source: src.source, candles: candles.length ? candles : [{ t: Date.now(), price: 1, vol: 0, buyers: 0, sellers: 0, earlySell: 0 }],
    snipers: sniperShare(holders), curvePct: src.curvePct || 0, gradMc: src.gradMc || 0,
    lpLocked: src.source !== "direct" && src.source !== "pools_trade", honeypot: false, mintable: !!src.mintable,
    poolDepthUsd: 0, deployerScore: deployer?.score || 0,
  };
  market.unlocks = SOURCE_UNLOCKS[market.source](market);
  const a = candles.length > 3 ? analyze(market) : null;

  const clones = (await explorer.search(info.symbol)).filter(c => c.address.toLowerCase() !== addr).slice(0, 6)
    .map(c => ({ name: c.name, sym: c.symbol, address: c.address, match: c.symbol === info.symbol ? "same ticker" : "similar name" }));

  return { token: { address: addr, name: info.name, symbol: info.symbol, holders: info.holders, supply: info.total_supply },
    launch: src, deployer, holders, candles, analysis: a, clones, indexed: !!candles.length,
    note: candles.length ? null : "No indexed swaps yet for this token — entry zone appears once the indexer has trade history." };
}
