import "server-only";
import * as schema from "./schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export { schema };

type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS shops (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  address text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  closes_at text NOT NULL,
  min_price_pct integer NOT NULL DEFAULT 30,
  no_show_fee_pct integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS listings (
  id text PRIMARY KEY,
  shop_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  contents jsonb NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_cents integer NOT NULL,
  price_cents integer NOT NULL,
  quantity integer NOT NULL,
  remaining integer NOT NULL,
  weight_grams integer NOT NULL DEFAULT 400,
  pickup_start timestamptz NOT NULL,
  pickup_end timestamptz NOT NULL,
  photo text,
  ai_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  listing_id text NOT NULL,
  shop_id text NOT NULL,
  buyer_name text NOT NULL,
  channel text NOT NULL,
  agent_name text,
  mandate_id text,
  paypal_order_id text,
  authorization_id text,
  amount_cents integer NOT NULL,
  captured_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_approval',
  pickup_code text NOT NULL,
  bag_check jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mandates (
  id text PRIMARY KEY,
  buyer_name text NOT NULL,
  agent_name text NOT NULL DEFAULT 'Personal AI assistant',
  token text NOT NULL,
  vault_id text,
  paypal_customer_id text,
  max_per_order_cents integer NOT NULL DEFAULT 600,
  max_per_week_cents integer NOT NULL DEFAULT 2500,
  preferences text NOT NULL DEFAULT '',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_km double precision NOT NULL DEFAULT 1.5,
  earliest_pickup text NOT NULL DEFAULT '17:00',
  standing_order boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY,
  shop_id text,
  listing_id text,
  reservation_id text,
  mandate_id text,
  actor text NOT NULL,
  type text NOT NULL,
  message text NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_shop_idx ON listings (shop_id);
CREATE INDEX IF NOT EXISTS reservations_listing_idx ON reservations (listing_id);
CREATE INDEX IF NOT EXISTS reservations_code_idx ON reservations (pickup_code);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at DESC);
`;

type Holder = { db?: Promise<DB> };
const holder = globalThis as unknown as { __crumbDb?: Holder };
holder.__crumbDb ??= {};

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { prepare: false, max: 5 });
    await client.unsafe(BOOTSTRAP_SQL);
    return drizzle(client, { schema }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { mkdirSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  // Outside the project folder on purpose: writes inside it would trigger the dev server's file watcher.
  const dir = process.env.PGLITE_DIR ?? join(homedir(), ".crumb", "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.exec(BOOTSTRAP_SQL);
  return drizzle(client, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  holder.__crumbDb!.db ??= connect().catch((err) => {
    holder.__crumbDb!.db = undefined;
    throw err;
  });
  return holder.__crumbDb!.db;
}
