/* Continuous indexer: pulls new ERC-20s, classifies them, snapshots holders,
   marks deaths, and keeps deployer scores current. Idempotent; safe to restart. */
import "dotenv/config";
import { db } from "./db.js";
import { explorer } from "../adapter/blockscout.js";
import { detectSource } from "../adapter/launchpad.js";
import { scoreDeployer } from "../scoring/deployer.js";

const POLL = +(process.env.POLL_MS || 15000);

async function ingestNew() {
  const items = await explorer.newTokens(2);
  for (const t of items) {
    const addr = t.address.toLowerCase();
    const seen = await db.query("select 1 from tokens where address=$1", [addr]);
    if (seen.rowCount) continue;
    const src = await detectSource(addr, db);
    await db.query(`insert into tokens(address,name,symbol,decimals,total_supply,deployer,creation_tx,created_at,source,verified,mintable,fp,last_seen)
      values($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,now()) on conflict do nothing`,
      [addr, t.name, t.symbol, +t.decimals || 18, t.total_supply || null, src.creator, src.creationTx, src.source, src.verified, src.mintable, src.fp]);
    if (src.creator) await db.query("insert into deployers(address,launches,updated_at) values($1,1,now()) on conflict(address) do update set launches=deployers.launches+1, updated_at=now()", [src.creator]);
    await snapshotHolders(addr, src.creator);
    console.log("indexed", t.symbol, addr, src.source);
  }
}

async function snapshotHolders(addr, deployer) {
  const hs = await explorer.holders(addr, 25);
  const total = hs.reduce((a, h) => a + Number(h.value || 0), 0) || 1;
  // cluster wallets by funding source; deployer-funded wallets are cluster 0
  const clusters = new Map();
  for (const h of hs) {
    const w = h.address.hash.toLowerCase();
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
  // first-block buyers: transfers in the creation block
  const tr = await explorer.transfers(addr, 2);
  const firstBlock = Math.min(...tr.map(t => t.block_number || Infinity));
  for (const t of tr.filter(t => t.block_number === firstBlock)) {
    const w = t.to?.hash?.toLowerCase(); if (!w) continue;
    await db.query("update holders set first_block=true where token=$1 and wallet=$2", [addr, w]);
  }
}

async function markDeaths() {
  // no swaps in 48h after creation => dead. LP pull and honeypot flags are set by the API path when detected.
  await db.query(`update tokens set alive=false, died_at=now(), death_cause='no_trades_48h'
    where alive and created_at < now()-interval '48 hours'
    and not exists (select 1 from swaps s where s.token=tokens.address and s.ts > now()-interval '24 hours')`);
  const dead = await db.query("select deployer, count(*) c from tokens where alive=false and deployer is not null group by deployer");
  for (const r of dead.rows) await db.query("update deployers set dead_48h=$2 where address=$1", [r.deployer, +r.c]);
  const ds = await db.query("select * from deployers");
  for (const d of ds.rows) await db.query("update deployers set score=$2, updated_at=now() where address=$1", [d.address, scoreDeployer(d)]);
}

async function loop() {
  try { await ingestNew(); await markDeaths(); } catch (e) { console.error("indexer:", e.message); }
  setTimeout(loop, POLL);
}
console.log("indexer up, polling every", POLL, "ms");
loop();
