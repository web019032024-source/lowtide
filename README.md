# Lowtide

Lower-risk entry analytics for meme tokens on Robinhood Chain (chain id 4663).
Detects how a token launched (Pons V1/V2, hood.fun, Pools.trade, direct), reads the
curve or pool plus the wallets, and shows an entry zone with reasoning and invalidation.

## Run in one command

**Option A — Railway (recommended, ~5 minutes, no terminal)**
1. Push this folder to a GitHub repo.
2. On railway.app: New project → Deploy from GitHub → pick the repo. Add a Postgres plugin.
3. Set variables from `.env.example` (Railway injects `DATABASE_URL` automatically).
4. Add a second service from the same repo with start command `npm run index`.
Done: the URL Railway gives you is the live site.

**Option B — anywhere with Docker**
```
cp .env.example .env
docker compose up -d
```
Site on http://localhost:8080. Indexer starts filling the database immediately.

## What runs
- `src/api/server.js` — serves the site and `/api/token/:address`, `/api/deployer/:address`, `/api/watch`.
- `src/indexer/run.js` — polls the explorer for new tokens, classifies launch source, snapshots holders,
  clusters wallets by funding source, marks first-block snipers, records deaths, scores deployers.
- `src/scoring/` — pure functions (entry zone, risk, survival, deployer score). `npm test` covers them.

## Fill these in once (env)
Factory addresses for Pons V1/V2, hood.fun, Pools.trade, and the Uniswap v4 PoolManager on Robinhood Chain.
Detection works without them via bytecode fingerprints learned by the indexer, but factory addresses make
it exact from day one. Get them from each platform's docs or the explorer.

## Roadmap already scaffolded
- `swaps` table is written by the indexer once the Uniswap pool ABI decoding is added
  (`src/indexer/run.js` → add a `syncSwaps()` step reading Swap events per token). Until then the
  API returns the report without an entry zone and the UI says so.
- Survival model: replace weights in `analyze.js` with a logistic model trained on the `tokens` table
  once a few thousand launches are indexed.
- Alerts: `watches` table exists; add a worker that evaluates conditions each poll and pushes via Telegram bot.
