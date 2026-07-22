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
 * Add order spend to the customer's carry-over balance and award credits.
 * Example: remainder £9 + order £11 = £20 → 2 credits, remainder £0.
 */
export async function applyOrderSpend(
  shopifyCustomerId: string,
  orderTotal: number,
  profile?: CustomerProfile | string | null
): Promise<{
  customer: Customer;
  creditsAdded: number;
  previousRemainder: number;
  newRemainder: number;
  pooledSpend: number;
}> {
  const total = roundMoney(Math.max(0, orderTotal));
  const perCredit = config.creditsPoundsPerCredit;
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

    const locked = await client.query<Customer>(
      `SELECT * FROM customers WHERE shopify_customer_id = $1 FOR UPDATE`,
      [shopifyCustomerId]
    );
    const current = mapCustomer(locked.rows[0]);
    const previousRemainder = current.spend_remainder;
    const pooledSpend = roundMoney(previousRemainder + total);
    const creditsAdded = Math.floor(pooledSpend / perCredit);
    const newRemainder = roundMoney(pooledSpend - creditsAdded * perCredit);

    const updated = await client.query<Customer>(
      `UPDATE customers
       SET credits = credits + $2,
           spend_remainder = $3,
           total_spend = total_spend + $4,
           updated_at = NOW()
       WHERE shopify_customer_id = $1
       RETURNING *`,
      [shopifyCustomerId, creditsAdded, newRemainder, total]
    );

    await client.query('COMMIT');
    return {
      customer: mapCustomer(updated.rows[0]),
      creditsAdded,
      previousRemainder,
      newRemainder,
      pooledSpend,
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

export async function listCustomers(search?: string, limit = 100, offset = 0): Promise<Customer[]> {
  if (search) {
    const { rows } = await query<Customer>(
      `SELECT * FROM customers
       WHERE shopify_customer_id ILIKE $1
          OR COALESCE(email, '') ILIKE $1
          OR COALESCE(name, '') ILIKE $1
          OR COALESCE(company, '') ILIKE $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    return rows.map(mapCustomer);
  }
  const { rows } = await query<Customer>(
    `SELECT * FROM customers ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapCustomer);
}
