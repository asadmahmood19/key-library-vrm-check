import { Pool } from 'pg';
import { config } from './config';

function buildConnectionString(url: string): string {
  try {
    const u = new URL(url);
    // Silence pg sslmode deprecation warning on Neon URLs
    if (!u.searchParams.has('uselibpqcompat')) {
      u.searchParams.set('uselibpqcompat', 'true');
    }
    if (!u.searchParams.get('sslmode')) {
      u.searchParams.set('sslmode', 'require');
    }
    return u.toString();
  } catch {
    return url;
  }
}

export const pool = new Pool({
  connectionString: buildConnectionString(config.databaseUrl),
  ssl: { rejectUnauthorized: false },
});

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  shopify_customer_id TEXT PRIMARY KEY,
  email TEXT,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_cache (
  vrm TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lookups (
  id BIGSERIAL PRIMARY KEY,
  shopify_customer_id TEXT NOT NULL REFERENCES customers(shopify_customer_id),
  vrm TEXT NOT NULL,
  was_cached BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lookups_customer_created
  ON lookups (shopify_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lookups_created
  ON lookups (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_cache_fetched
  ON vehicle_cache (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_email
  ON customers (email);

CREATE TABLE IF NOT EXISTS processed_orders (
  shopify_order_id TEXT PRIMARY KEY,
  shopify_customer_id TEXT,
  credits_added INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS spend_remainder NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spend NUMERIC(12, 2) NOT NULL DEFAULT 0;
`;

let migrated = false;

export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  await pool.query(SCHEMA_SQL);
  migrated = true;
}
