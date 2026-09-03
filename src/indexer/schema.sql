-- Lowtide index. Every launch on Robinhood Chain, who deployed it, who sniped it, and how it ended.
create table if not exists tokens (
  address text primary key,
  name text, symbol text, decimals int, total_supply numeric,
  deployer text, creation_tx text, created_at timestamptz,
  source text,                 -- pons_v2_curve | pons_v2_grad | pons_v1 | hoodfun | pools_trade | direct
  verified boolean, mintable boolean, fp text,
  graduated_at timestamptz,
  last_seen timestamptz, alive boolean default true,
  died_at timestamptz, death_cause text  -- lp_pulled | no_trades_48h | honeypot
);
create index if not exists tokens_deployer on tokens(deployer);
create index if not exists tokens_symbol on tokens(lower(symbol));

create table if not exists deployers (
  address text primary key,
  launches int default 0, dead_48h int default 0, lp_pulls int default 0, honeypots int default 0,
  score numeric,               -- 0..100, higher = worse
  updated_at timestamptz
);

create table if not exists holders (
  token text references tokens(address), wallet text, pct numeric, first_block boolean default false,
  cluster int, funded_by text, snapshot_at timestamptz,
  primary key (token, wallet)
);

create table if not exists swaps (
  token text references tokens(address), tx text, ts timestamptz, side text, usd numeric, price_usd numeric, wallet text,
  primary key (token, tx)
);
create index if not exists swaps_token_ts on swaps(token, ts);

create table if not exists fingerprints (fp text primary key, platform text, note text);
create table if not exists watches (id serial primary key, token text, wallet text, kind text, created_at timestamptz default now());

-- swap indexing state (added in v0.2)
alter table tokens add column if not exists pool text;
alter table tokens add column if not exists pool_kind text;      -- v2 | v3
alter table tokens add column if not exists quote_token text;
alter table tokens add column if not exists quote_symbol text;
alter table tokens add column if not exists swap_cursor bigint default 0;  -- last block scanned
alter table tokens add column if not exists swaps_synced_at timestamptz;
alter table swaps add column if not exists block bigint;
