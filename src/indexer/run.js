/* Continuous indexer: pulls new ERC-20s, classifies them, snapshots holders,
   marks deaths, and keeps deployer scores current. Idempotent; safe to restart. */
import "dotenv/config";
import { db } from "./db.js";
import { explorer } from "../adapter/blockscout.js";
import { detectSource } from "../adapter/launchpad.js";
import { scoreDeployer } from "../scoring/deployer.js";
import { syncSwaps } from "./swaps.js";

const POLL = +(process.env.POLL_MS || 15000);
const addrOf = (o) => (o?.address_hash || o?.address?.hash || (typeof o?.address === "string" ? o.address : null) || o?.contract_address_hash || o?.hash || "").toLowerCase();

async function ingestNew() {
  const items = await explorer.newTokens(2);
  for (const t of items) {
    const addr = addrOf(t);
    if (!addr) continue;
    const seen = await db.query("select 1 from tokens where address=$1", [addr]);
    if (seen.rowCount) continue;
    let src;
    try { src = await detectSource(addr, db); }
    catch (e) { src = { source: "direct", evidence: "detect failed: " + e.message, creator: null, creationTx: null, verified: null, mintable: null, fp: null }; }
    await db.query(`insert into tokens(address,name,symbol,decimals,total_supply,deployer,creation_tx,created_at,source,verified,mintable,fp,last_seen)
      values($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,now()) on conflict do nothing`,
      [addr, t.name || null, t.symbol || null, +t.decimals || 18, t.total_supply || null, src.creator, src.creationTx, src.source, src.verified, src.mintable, src.fp]);
    if (src.creator) await db.query("insert into deployers(address,launches,updated_at) values($1,1,now()) on conflict(address) do update set launches=deployers.launches+1, updated_at=now()", [src.creator]);
    try { await snapshotHolders(addr, src.creator); } catch (e) { console.error("holders:", addr, e.message); }
    console.log("indexed", t.symbol, addr, src.source);
  }
}

async function snapshotHolders(addr, deployer) {
  const hs = await explorer.holders(addr, 25);
  const total = hs.reduce((a, h) => a + Number(h.value || 0), 0) || 1;
  const clusters = new Map();
  for (const h of hs.slice(0, 10)) {
    const w = addrOf(h);
    if (!w) continue;
    let funded = null, cluster = null;
    try { const srcs = await explorer.fundingSources(w); funded = srcs[0] || null; } catch {}
    if (funded) {
      if (funded === deployer) cluster = 0;
      else { if (!clusters.has(funded)) clusters.set(funded, clusters.size + 1); cluster = clusters.get(funded); }
    }
    await db.query(`insert into holders(token,wallet,pct,cluster,funded_by,snapshot_at) values($1,$2,$3,$4,$5,now())
      on conflict(token,wallet) do update set pct=$3,cluster=$4,funded_by=$5,snapshot_at=now()`,
      [addr, w, Number(h.value || 0) / total * 100, cluster, funded]);
  }
  const tr = await explorer.transfers(addr, 2);
  if (!tr.length) return;
  const firstBlock = Math.min(...tr.map(t => t.block_number ?? t.block ?? Infinity));
  for (const t of tr.filter(t => (t.block_number ?? t.block) === firstBlock)) {
    const w = addrOf(t.to);
    if (!w) continue;
    await db.query("update holders set first_block=true where token=$1 and wallet=$2", [addr, w]);
  }
}

async function syncRecentSwaps() {
  const rows = (await db.query(`select address from tokens where alive order by coalesce(swaps_synced_at, to_timestamp(0)) asc limit 6`)).rows;
  for (const r of rows) {
    try { const n = await syncSwaps(db, r.address); if (n) console.log("swaps", r.address, "+" + n); }
    catch (e) { console.error("swaps:", r.address, e.message); }
  }
}

async function markDeaths() {
  await db.query(`update tokens set alive=false, died_at=now(), death_cause='no_trades_48h'
    where alive and created_at < now()-interval '48 hours'
    and not exists (select 1 from swaps s where s.token=tokens.address and s.ts > now()-interval '24 hours')`);
  const dead = await db.query("select deployer, count(*) c from tokens where alive=false and deployer is not null group by deployer");
  for (const r of dead.rows) await db.query("update deployers set dead_48h=$2 where address=$1", [r.deployer, +r.c]);
  const ds = await db.query("select * from deployers");
  for (const d of ds.rows) await db.query("update deployers set score=$2, updated_at=now() where address=$1", [d.address, scoreDeployer(d)]);
}

async function loop() {
  try { await ingestNew(); await syncRecentSwaps(); await markDeaths(); } catch (e) { console.error("indexer:", e.message); }
  setTimeout(loop, POLL);
}
console.log("indexer up, polling every", POLL, "ms");
loop();
