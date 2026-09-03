/* Swap indexing: find a token's Uniswap pool, decode Swap events from the
   explorer's decoded logs, and store trades with USD price.
   Supports Uniswap v2-style (amount0In/Out) and v3 (amount0/amount1) pools.
   Uniswap v4 (PoolManager singleton) is handled when UNISWAP_V4_POOL_MANAGER is set. */
import { explorer } from "../adapter/blockscout.js";

const STABLES = new Set(["USDC", "USDT", "USDG", "DAI", "USDC.E", "USDE"]);
const lower = (s) => (s || "").toLowerCase();
const addrOf = (o) => lower(o?.address_hash || o?.address?.hash || (typeof o?.address === "string" ? o.address : null) || o?.hash);

let ethUsdCache = { v: 0, t: 0 };
export async function ethUsd() {
  if (Date.now() - ethUsdCache.t < 5 * 60e3 && ethUsdCache.v) return ethUsdCache.v;
  try { const s = await explorer.stats(); const v = +(s?.coin_price || 0); if (v) ethUsdCache = { v, t: Date.now() }; } catch {}
  return ethUsdCache.v || 0;
}

/* Pool = the largest holder that is a contract and holds a second token (the quote). */
export async function findPool(token, holders) {
  const contracts = holders.filter(h => h.address?.is_contract || h.is_contract);
  for (const h of contracts.slice(0, 5)) {
    const pool = addrOf(h);
    if (!pool) continue;
    let bal; try { bal = await explorer.tokenBalances(pool); } catch { continue; }
    const others = (bal || []).map(b => ({ addr: addrOf(b.token), sym: b.token?.symbol || "", dec: +b.token?.decimals || 18 })).filter(b => b.addr && b.addr !== lower(token));
    if (!others.length) continue;
    const quote = others.find(o => STABLES.has(o.sym.toUpperCase())) || others.find(o => /^W?ETH$/i.test(o.sym)) || others[0];
    return { pool, quote: quote.addr, quoteSymbol: quote.sym, quoteDec: quote.dec };
  }
  return null;
}

/* Decode one explorer log into a trade, or null. Pure — unit tested. */
export function decodeSwap(log, token, quote, tokenDec, quoteDec, quoteUsd) {
  const call = log?.decoded?.method_call || "";
  if (!/^Swap\(/.test(call)) return null;
  const p = Object.fromEntries((log.decoded.parameters || []).map(x => [x.name, x.value]));
  const token0 = lower(token) < lower(quote) ? lower(token) : lower(quote);
  const tokIs0 = token0 === lower(token);
  let tokAmt, quoAmt; // from the pool's perspective: positive = pool received
  if ("amount0" in p) { // v3 / v4
    const a0 = BigInt(p.amount0), a1 = BigInt(p.amount1);
    tokAmt = tokIs0 ? a0 : a1; quoAmt = tokIs0 ? a1 : a0;
  } else if ("amount0In" in p) { // v2
    const in0 = BigInt(p.amount0In), in1 = BigInt(p.amount1In), out0 = BigInt(p.amount0Out), out1 = BigInt(p.amount1Out);
    const a0 = in0 - out0, a1 = in1 - out1;
    tokAmt = tokIs0 ? a0 : a1; quoAmt = tokIs0 ? a1 : a0;
  } else return null;
  if (tokAmt === 0n) return null;
  const side = tokAmt < 0n ? "buy" : "sell"; // pool lost tokens → someone bought
  const tokens = Number(tokAmt < 0n ? -tokAmt : tokAmt) / 10 ** tokenDec;
  const quoteAmt = Number(quoAmt < 0n ? -quoAmt : quoAmt) / 10 ** quoteDec;
  const usd = quoteAmt * quoteUsd;
  if (!tokens || !usd) return null;
  return {
    tx: log.transaction_hash || log.tx_hash, block: +(log.block_number || 0),
    ts: log.block_timestamp ? new Date(log.block_timestamp) : null,
    side, usd, price_usd: usd / tokens,
    wallet: lower(p.recipient || p.to || p.sender || log.decoded?.parameters?.find(x => x.type === "address")?.value || ""),
  };
}

/* Sync swaps for one token. Returns number of new trades stored. */
export async function syncSwaps(db, token) {
  const t = (await db.query("select address,decimals,pool,quote_token,quote_symbol,swap_cursor from tokens where address=$1", [token])).rows[0];
  if (!t) return 0;
  let { pool, quote_token: quote, quote_symbol: quoteSym } = t, quoteDec = 18;
  if (!pool) {
    const holders = await explorer.holders(token, 25);
    const found = await findPool(token, holders);
    if (!found) { await db.query("update tokens set swaps_synced_at=now() where address=$1", [token]); return 0; }
    ({ pool, quote, quoteSymbol: quoteSym, quoteDec } = found);
    await db.query("update tokens set pool=$2, quote_token=$3, quote_symbol=$4 where address=$1", [token, pool, quote, quoteSym]);
  } else {
    try { const qi = await explorer.token(quote); quoteDec = +qi?.decimals || 18; } catch {}
  }
  const quoteUsd = STABLES.has((quoteSym || "").toUpperCase()) ? 1 : await ethUsd();
  if (!quoteUsd) return 0;
  const logs = await explorer.logs(pool, 4);
  let n = 0, maxBlock = +t.swap_cursor || 0;
  for (const l of logs) {
    if (+(l.block_number || 0) <= (+t.swap_cursor || 0)) continue;
    const s = decodeSwap(l, token, quote, +t.decimals || 18, quoteDec, quoteUsd);
    if (!s) continue;
    if (!s.ts) { try { const tx = await explorer.tx(s.tx); s.ts = new Date(tx.timestamp); } catch { s.ts = new Date(); } }
    await db.query(`insert into swaps(token,tx,ts,side,usd,price_usd,wallet,block) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
      [token, s.tx, s.ts, s.side, s.usd, s.price_usd, s.wallet, s.block]);
    n++; if (s.block > maxBlock) maxBlock = s.block;
  }
  await db.query("update tokens set swap_cursor=$2, swaps_synced_at=now(), last_seen=now() where address=$1", [token, maxBlock]);
  return n;
}
