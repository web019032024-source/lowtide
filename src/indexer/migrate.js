import { readFileSync } from "node:fs";
import { db } from "./db.js";
const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
await db.query(sql);
console.log("schema ready");
await db.end();
