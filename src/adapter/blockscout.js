/* Blockscout adapter for Robinhood Chain (chain id 4663).
   Uses the PRO API with a free key when EXPLORER_API_KEY is set,
   otherwise the public explorer. */
const KEY = process.env.EXPLORER_API_KEY || "";
const BASE = process.env.EXPLORER_API || (KEY ? "https://api.blockscout.com/4663/api/v2" : "https://robinhoodchain.blockscout.com/api/v2");
const HEADERS = { accept: "application/json", "user-agent": "Lowtide/0.1 (+https://github.com/web019032024-source/lowtide)" };

async function fetchJson(path, params = {}, tries = 3) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  if (KEY) url.searchParams.set("apikey", KEY);
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: HEADERS });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 500 * (i + 1))); continue; }
    throw new Error(`${r.status} ${url.origin}${url.pathname}`);
  }
  throw new Error(`explorer unavailable: ${url.origin}${url.pathname}`);
}

async function* paginate(path, params = {}, maxPages = 5) {
  let next = null, page = 0;
  do {
    const data = await fetchJson(path, { ...params, ...(next || {}) });
    if (!data) return;
    for (const item of data.items || []) yield item;
    next = data.next_page_params; page++;
  } while (next && page < maxPages);
}

export const explorer = {
  token: (addr) => fetchJson(`/tokens/${addr}`),
  address: (addr) => fetchJson(`/addresses/${addr}`),
  contractCode: (addr) => fetchJson(`/smart-contracts/${addr}`),
  async holders(addr, max = 50) {
    const out = [];
    for await (const h of paginate(`/tokens/${addr}/holders`, {}, 2)) { out.push(h); if (out.length >= max) break; }
    return out;
  },
  async transfers(addr, maxPages = 10) {
    const out = [];
    for await (const t of paginate(`/tokens/${addr}/transfers`, {}, maxPages)) out.push(t);
    return out;
  },
  async fundingSources(addr) {
    const out = [];
    for await (const tx of paginate(`/addresses/${addr}/transactions`, { filter: "to" }, 2)) {
      if (tx.value && tx.value !== "0" && tx.from?.hash) out.push(tx.from.hash.toLowerCase());
    }
    return [...new Set(out)];
  },
  async newTokens(maxPages = 2) {
    const out = [];
    for await (const t of paginate(`/tokens`, { type: "ERC-20" }, maxPages)) out.push(t);
    return out;
  },
  async search(q) {
    const d = await fetchJson(`/search`, { q });
    return (d?.items || []).filter(i => i.type === "token");
  }
};
