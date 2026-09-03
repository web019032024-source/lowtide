/* Turn raw explorer data into the market shape analyze() expects.
   Swaps → 5-minute candles; holders → snipers/cluster stats; DB → unlocks/deployer score. */
export function toCandles(swaps, minutes = 5, maxCandles = 96) {
  if (!swaps.length) return [];
  const bucket = minutes * 60e3, sorted = [...swaps].sort((a, b) => a.ts - b.ts);
  const start = Math.max(sorted[0].ts, sorted[sorted.length - 1].ts - bucket * maxCandles);
  const map = new Map();
  let last = sorted[0].price_usd;
  for (const s of sorted) {
    if (s.ts < start) { last = s.price_usd; continue; }
    const k = Math.floor((s.ts - start) / bucket);
    const c = map.get(k) || { t: start + k * bucket, price: last, vol: 0, buyers: 0, sellers: 0, earlySell: 0 };
    c.price = s.price_usd; c.vol += s.usd; if (s.side === "buy") c.buyers++; else c.sellers++;
    if (s.early && s.side === "sell") c.earlySell += s.usd;
    map.set(k, c); last = s.price_usd;
  }
  const out = []; let prev = { price: sorted[0].price_usd };
  const n = Math.floor((sorted[sorted.length - 1].ts - start) / bucket) + 1;
  for (let k = 0; k < n; k++) { const c = map.get(k) || { t: start + k * bucket, price: prev.price, vol: 0, buyers: 0, sellers: 0, earlySell: 0 }; out.push(c); prev = c; }
  return out;
}
export function sniperShare(holders) {
  const tot = holders.reduce((a, h) => a + +h.pct, 0) || 1;
  return holders.filter(h => h.first_block).reduce((a, h) => a + +h.pct, 0) / tot;
}
