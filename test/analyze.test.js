import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/scoring/analyze.js";
import { scoreDeployer } from "../src/scoring/deployer.js";
import { toCandles, sniperShare } from "../src/scoring/normalize.js";

function pumpCandles() {
  const c = []; for (let i = 0; i < 96; i++) { let p; if (i < 20) p = 50000; else if (i < 55) p = 50000 + 150000 * ((i - 20) / 35) ** 1.6; else p = 200000 * (1 - .28 * ((i - 55) / 40) ** .7);
    c.push({ t: i, price: p, vol: 1000, buyers: i > 55 ? 3 : 8, sellers: i > 55 ? 6 : 2, earlySell: i > 52 && i < 60 ? 500 : 0 }); } return c;
}
test("zone sits below current price after a pump and above the base", () => {
  const a = analyze({ source: "direct", candles: pumpCandles(), snipers: .3, lpLocked: false, honeypot: false, mintable: false, poolDepthUsd: 40000, unlocks: [{ h: 6, pct: 9, label: "cliff" }], deployerScore: 40 });
  assert.ok(a.zone[0] < a.now && a.zone[1] < a.peak);
  assert.ok(a.zone[0] > a.base);
  assert.equal(a.state, "high");
});
test("curve tokens get a post-graduation zone and ignore vwap", () => {
  const cs = Array.from({ length: 30 }, (_, i) => ({ t: i, price: 50000 + i * 3000, vol: 500, buyers: 5, sellers: 1, earlySell: 0 }));
  const a = analyze({ source: "pons_v2_curve", candles: cs, snipers: .2, curvePct: .68, gradMc: 265000, lpLocked: true, honeypot: false, mintable: false, poolDepthUsd: 0, unlocks: [], deployerScore: 0 });
  assert.deepEqual(a.zone.map(Math.round), [164300, 201400]); assert.equal(a.aboveVwap, 1);
});
test("locked liquidity lowers risk versus unlocked", () => {
  const base = { source: "direct", candles: pumpCandles(), snipers: .1, honeypot: false, mintable: false, poolDepthUsd: 40000, unlocks: [], deployerScore: 0 };
  assert.ok(analyze({ ...base, lpLocked: true }).risk < analyze({ ...base, lpLocked: false }).risk);
});
test("deployer score rises with dead launches", () => {
  assert.ok(scoreDeployer({ launches: 6, dead_48h: 4 }) > scoreDeployer({ launches: 6, dead_48h: 0 }));
  assert.equal(scoreDeployer({ launches: 0 }), 0);
});
test("candles bucket swaps and carry price forward", () => {
  const c = toCandles([{ ts: 0, side: "buy", usd: 10, price_usd: 1 }, { ts: 11 * 60e3, side: "sell", usd: 5, price_usd: 2, early: true }]);
  assert.equal(c.length, 3); assert.equal(c[1].price, 1); assert.equal(c[2].earlySell, 5);
});
test("sniper share sums first-block holders", () => {
  assert.equal(sniperShare([{ pct: 10, first_block: true }, { pct: 30 }]), .25);
});
