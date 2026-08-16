import { pool, query } from '../db';
import { config } from '../config';

export interface Customer {
  shopify_customer_id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  credits: number;
  spend_remainder: number;
  total_spend: number;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerProfile {
  email?: string | null;
  name?: string | null;
  company?: string | null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeProfile(
  profile?: CustomerProfile | string | null
): CustomerProfile {
  if (profile == null) return {};
  if (typeof profile === 'string') return { email: profile };
  return profile;
}

function mapCustomer(row: Customer): Customer {
  return {
    ...row,
    email: row.email || null,
    name: row.name || null,
    company: row.company || null,
    credits: Number(row.credits),
    spend_remainder: Number(row.spend_remainder || 0),
    total_spend: Number(row.total_spend || 0),
  };
}

export async function upsertCustomer(
  shopifyCustomerId: string,
  profile?: CustomerProfile | string | null
): Promise<Customer> {
  const p = normalizeProfile(profile);
  const { rows } = await query<Customer>(
    `INSERT INTO customers (shopify_customer_id, email, name, company, credits)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (shopify_customer_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, customers.email),
           name = COALESCE(EXCLUDED.name, customers.name),
           company = COALESCE(EXCLUDED.company, customers.company),
           updated_at = NOW()
     RETURNING *`,
    [shopifyCustomerId, p.email || null, p.name || null, p.company || null]
  );
  return mapCustomer(rows[0]);
}

export async function getCustomer(shopifyCustomerId: string): Promise<Customer | null> {
  const { rows } = await query<Customer>(
    `SELECT * FROM customers WHERE shopify_customer_id = $1`,
    [shopifyCustomerId]
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function getCustomerByEmail(email: string): Promise<Customer | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await query<Customer>(
    `SELECT * FROM customers
     WHERE LOWER(TRIM(email)) = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalized]
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

/** Set credits for an existing customer found by email. */
export async function setCreditsByEmail(
  email: string,
  credits: number
): Promise<Customer> {
  if (credits < 0) throw new Error('Credits cannot be negative');
  const existing = await getCustomerByEmail(email);
  if (!existing) {
    throw new Error('No customer found with that email. They must visit the checker or place an order first.');
  }
  const { rows } = await query<Customer>(
    `UPDATE customers
     SET credits = $2,
         email = COALESCE(email, $3),
         updated_at = NOW()
     WHERE shopify_customer_id = $1
     RETURNING *`,
    [existing.shopify_customer_id, Math.floor(credits), email.trim()]
  );
  return mapCustomer(rows[0]);
}

export async function setCredits(
  shopifyCustomerId: string,
  credits: number,
  profile?: CustomerProfile | string | null
): Promise<Customer> {
  if (credits < 0) throw new Error('Credits cannot be negative');
  await upsertCustomer(shopifyCustomerId, profile);
  const { rows } = await query<Customer>(
    `UPDATE customers
     SET credits = $2, updated_at = NOW()
     WHERE shopify_customer_id = $1
     RETURNING *`,
    [shopifyCustomerId, credits]
  );
  return mapCustomer(rows[0]);
}

/** Set the same credit balance on many customers at once. */
export async function setCreditsBulk(
  shopifyCustomerIds: string[],
  credits: number
): Promise<number> {
  if (credits < 0) throw new Error('Credits cannot be negative');
  const ids = Array.from(
    new Set(
      shopifyCustomerIds
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  if (!ids.length) return 0;
  const { rowCount } = await query(
    `UPDATE customers
     SET credits = $1, updated_at = NOW()
     WHERE shopify_customer_id = ANY($2::text[])`,
    [Math.floor(credits), ids]
  );
  return rowCount || 0;
}

/** Set different credit balances per customer in one request. */
export async function setCreditsBulkUpdates(
  updates: Array<{ customer_id: string; credits: number }>
): Promise<number> {
  const cleaned = updates
    .map((u) => ({
      customer_id: String(u.customer_id || '').trim(),
      credits: Math.floor(Number(u.credits)),
    }))
    .filter((u) => u.customer_id && Number.isFinite(u.credits) && u.credits >= 0);

  if (!cleaned.length) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let updated = 0;
    for (const row of cleaned) {
      const result = await client.query(
        `UPDATE customers
         SET credits = $2, updated_at = NOW()
         WHERE shopify_customer_id = $1`,
        [row.customer_id, row.credits]
      );
      updated += result.rowCount || 0;
    }
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function adjustCredits(
  shopifyCustomerId: string,
  delta: number
): Promise<Customer> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<Customer>(
      `SELECT * FROM customers WHERE shopify_customer_id = $1 FOR UPDATE`,
      [shopifyCustomerId]
    );
    if (!current.rows[0]) {
      throw new Error('Customer not found');
    }
    const next = Number(current.rows[0].credits) + delta;
    if (next < 0) {
      throw new Error('Insufficient credits');
    }
    const updated = await client.query<Customer>(
      `UPDATE customers SET credits = $2, updated_at = NOW()
       WHERE shopify_customer_id = $1 RETURNING *`,
      [shopifyCustomerId, next]
    );
    await client.query('COMMIT');
    return mapCustomer(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Award credits from a single order's spend (no carry-over between orders).
 * Example: £15 order → 1 credit; leftover £5 is discarded, not saved for next order.
 */
export async function applyOrderSpend(
  shopifyCustomerId: string,
  orderTotal: number,
  profile?: CustomerProfile | string | null
): Promise<{
  customer: Customer;
  creditsAdded: number;
  orderSpend: number;
}> {
  const total = roundMoney(Math.max(0, orderTotal));
  const perCredit = config.creditsPoundsPerCredit;
  const creditsAdded = Math.floor(total / perCredit);
  const p = normalizeProfile(profile);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO customers (shopify_customer_id, email, name, company, credits)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (shopify_customer_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, customers.email),
             name = COALESCE(EXCLUDED.name, customers.name),
             company = COALESCE(EXCLUDED.company, customers.company),
             updated_at = NOW()`,
      [shopifyCustomerId, p.email || null, p.name || null, p.company || null]
    );

    const updated = await client.query<Customer>(
      `UPDATE customers
       SET credits = credits + $2,
           spend_remainder = 0,
           total_spend = total_spend + $3,
           updated_at = NOW()
       WHERE shopify_customer_id = $1
       RETURNING *`,
      [shopifyCustomerId, creditsAdded, total]
    );

    await client.query('COMMIT');
    return {
      customer: mapCustomer(updated.rows[0]),
      creditsAdded,
      orderSpend: total,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Deduct one credit atomically. Returns null if insufficient. */
export async function deductOneCredit(shopifyCustomerId: string): Promise<Customer | null> {
  const { rows } = await query<Customer>(
    `UPDATE customers
     SET credits = credits - 1, updated_at = NOW()
     WHERE shopify_customer_id = $1 AND credits > 0
     RETURNING *`,
    [shopifyCustomerId]
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function listCustomers(search?: string, limit = 100, offset = 0): Promise<
  Array<Customer & { credits_used: number }>
> {
  if (search) {
    const { rows } = await query<Customer & { credits_used: string | number }>(
      `SELECT c.*,
              COALESCE((
                SELECT COUNT(*)::int
                FROM lookups l
                WHERE l.shopify_customer_id = c.shopify_customer_id
                  AND l.was_cached = FALSE
              ), 0) AS credits_used
       FROM customers c
       WHERE c.shopify_customer_id ILIKE $1
          OR COALESCE(c.email, '') ILIKE $1
          OR COALESCE(c.name, '') ILIKE $1
          OR COALESCE(c.company, '') ILIKE $1
       ORDER BY c.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    return rows.map((row) => ({
      ...mapCustomer(row),
      credits_used: Number(row.credits_used || 0),
    }));
  }
  const { rows } = await query<Customer & { credits_used: string | number }>(
    `SELECT c.*,
            COALESCE((
              SELECT COUNT(*)::int
              FROM lookups l
              WHERE l.shopify_customer_id = c.shopify_customer_id
                AND l.was_cached = FALSE
            ), 0) AS credits_used
     FROM customers c
     ORDER BY c.updated_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((row) => ({
    ...mapCustomer(row),
    credits_used: Number(row.credits_used || 0),
  }));
}

export async function countCustomers(search?: string): Promise<number> {
  if (search) {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM customers
       WHERE shopify_customer_id ILIKE $1
          OR COALESCE(email, '') ILIKE $1
          OR COALESCE(name, '') ILIKE $1
          OR COALESCE(company, '') ILIKE $1`,
      [`%${search}%`]
    );
    return Number(rows[0]?.count || 0);
  }
  const { rows } = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM customers`);
  return Number(rows[0]?.count || 0);
}

export async function listCustomerIds(search?: string): Promise<string[]> {
  if (search) {
    const { rows } = await query<{ shopify_customer_id: string }>(
      `SELECT shopify_customer_id FROM customers
       WHERE shopify_customer_id ILIKE $1
          OR COALESCE(email, '') ILIKE $1
          OR COALESCE(name, '') ILIKE $1
          OR COALESCE(company, '') ILIKE $1
       ORDER BY updated_at DESC`,
      [`%${search}%`]
    );
    return rows.map((r) => r.shopify_customer_id);
  }
  const { rows } = await query<{ shopify_customer_id: string }>(
    `SELECT shopify_customer_id FROM customers ORDER BY updated_at DESC`
  );
  return rows.map((r) => r.shopify_customer_id);
}
