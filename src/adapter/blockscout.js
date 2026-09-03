/* Blockscout v2 adapter for Robinhood Chain.
   Every function returns plain JSON; nothing here knows about scoring.
   All calls go through fetchJson so retries/rate limits live in one place. */
const BASE = process.env.EXPLORER_API || "https://robinhoodchain.blockscout.com/api/v2";

async function fetchJson(path, params = {}, tries = 3) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 500 * (i + 1))); continue; }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error(`explorer unavailable: ${url}`);
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
  /* Who sent ETH to this wallet — how we trace bundled wallets back to a deployer. */
  async fundingSources(addr) {
    const out = [];
    for await (const tx of paginate(`/addresses/${addr}/transactions`, { filter: "to" }, 2)) {
      if (tx.value && tx.value !== "0" && tx.from?.hash) out.push(tx.from.hash.toLowerCase());
    }
    return [...new Set(out)];
  },
  async newTokens(maxPages = 2) {
    const out = [];
    for await (const t of paginate(`/tokens`, { type: "ERC-20", sort: "created_at", order: "desc" }, maxPages)) out.push(t);
    return out;
  },
  async search(q) {
    const d = await fetchJson(`/search`, { q });
    return (d?.items || []).filter(i => i.type === "token");
  }
};
