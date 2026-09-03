import "dotenv/config";
import express from "express";
import { tokenReport } from "./token.js";

let db = null;
if (process.env.DATABASE_URL) { const m = await import("../indexer/db.js"); db = m.db; }
const app = express();
app.use(express.json());
app.use(express.static(new URL("../../public", import.meta.url).pathname));
app.get("/health", (_, res) => res.json({ ok: true, db: !!db }));
app.get("/api/token/:address", async (req, res) => {
  const a = req.params.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return res.status(400).json({ error: "Enter a full 0x contract address" });
  try { const r = await tokenReport(a, db); if (!r) return res.status(404).json({ error: "Token not found on Robinhood Chain" }); res.json(r); }
  catch (e) { console.error(e); res.status(502).json({ error: "Explorer unavailable, try again in a moment" }); }
});
app.get("/api/deployer/:address", async (req, res) => {
  if (!db) return res.json({ error: "index not configured" });
  const r = await db.query("select d.*, (select json_agg(json_build_object('address',address,'symbol',symbol,'alive',alive,'source',source) order by created_at desc) from tokens t where t.deployer=d.address) launches_list from deployers d where address=$1", [req.params.address.toLowerCase()]);
  res.json(r.rows[0] || { error: "unknown deployer" });
});
app.post("/api/watch", async (req, res) => {
  if (!db) return res.status(503).json({ error: "index not configured" });
  const { token, wallet, kind } = req.body || {};
  await db.query("insert into watches(token,wallet,kind) values($1,$2,$3)", [token, wallet, kind]);
  res.json({ ok: true });
});
const port = +(process.env.PORT || 8080);
app.listen(port, () => console.log("lowtide api on", port));
