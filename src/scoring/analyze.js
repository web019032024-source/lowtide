/* The entry-zone model. Input is normalized market data; output is what the UI renders.
   Pure and deterministic so it can be back-tested against historical swaps. */

/** @param {{source:string, candles:{t:number,price:number,vol:number,buyers:number,sellers:number,earlySell:number}[],
 *           snipers:number, curvePct?:number, gradMc?:number, lpLocked:boolean, honeypot:boolean, mintable:boolean,
 *           poolDepthUsd:number, unlocks:{h:number,pct:number,label:string}[], deployerScore:number}} m */
export function analyze(m) {
  const c = m.candles, N = c.length, isCurve = m.source === "pons_v2_curve";
  const prices = c.map(x => x.price), now = prices[N - 1], peak = Math.max(...prices);
  const ignite = igniteIndex(prices), base = prices[ignite];
  let pv = 0, vv = 0; for (let i = ignite; i < N; i++) { pv += c[i].price * c[i].vol; vv += c[i].vol; }
  const vwap = vv ? pv / vv : now;
  const w = Math.min(12, N), nb = c.slice(-w).reduce((a, x) => a + x.buyers, 0), ns = c.slice(-w).reduce((a, x) => a + x.sellers, 0);
  const holderGrowth = (nb - ns) / Math.max(1, nb + ns);
  const earlySold = c.reduce((a, x) => a + x.earlySell, 0);
  const earlyUnsold = 1 - earlySold / Math.max(1, earlySold + (m.earlyRemainingUsd ?? 5200));

  let zone, aboveVwap = now / vwap;
  if (isCurve) { zone = [m.gradMc * 0.62, m.gradMc * 0.76]; aboveVwap = 1; }
  else {
    const f38 = peak - (peak - base) * 0.382, f62 = peak - (peak - base) * 0.618;
    const a = Math.max(vwap, f38), b = Math.min(vwap, f62); zone = [Math.min(a, b), Math.max(a, b)];
  }
  const unlock72 = m.unlocks.filter(u => u.h <= 72).reduce((a, u) => a + u.pct, 0);
  const impact72 = m.poolDepthUsd ? Math.min(0.9, unlock72 / 100 * now / m.poolDepthUsd * 0.6) : 0;

  let risk = 18;
  if (isCurve) { risk += (m.curvePct || 0) * 30; risk += m.snipers * 40; }
  else { risk += Math.min(30, (aboveVwap - 1) * 40); risk += earlyUnsold * 18; risk += m.snipers * 15; }
  risk += m.lpLocked ? 0 : 18; risk += holderGrowth < 0 ? 10 : -5; risk += m.honeypot ? 20 : 0; risk += m.mintable ? 8 : 0;
  risk += (m.deployerScore || 0) * 0.15;
  risk = Math.round(Math.max(3, Math.min(97, risk)));

  let surv = 0.7; surv -= m.lpLocked ? 0 : 0.22; surv -= m.snipers > 0.25 ? 0.15 : 0.04; surv += holderGrowth > 0 ? 0.08 : -0.08;
  surv -= m.honeypot ? 0.35 : 0; surv -= isCurve ? 0.05 : 0; surv -= (m.deployerScore || 0) / 400;
  surv = Math.round(Math.max(0.04, Math.min(0.96, surv)) * 100);

  const state = risk >= 60 ? "high" : risk >= 35 ? "moderate" : "lower";
  const inZone = now >= zone[0] && now <= zone[1];
  return { now, peak, base, vwap, zone, inZone, holderGrowth, earlyUnsold, aboveVwap, unlock72, impact72, risk, state, survival: surv, ignite };
}

/* First candle where price leaves a ±8% band around the opening range for good. */
function igniteIndex(p) {
  const open = p[0];
  for (let i = 1; i < p.length; i++) if (p[i] > open * 1.08 && p.slice(i).every(x => x > open * 1.04)) return Math.max(0, i - 1);
  return 0;
}
