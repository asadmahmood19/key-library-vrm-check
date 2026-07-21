import { pool, query } from '../db';

export interface Customer {
  shopify_customer_id: string;
  email: string | null;
  credits: number;
  created_at: Date;
  updated_at: Date;
}

export async function upsertCustomer(
  shopifyCustomerId: string,
  email?: string | null
): Promise<Customer> {
  const { rows } = await query<Customer>(
    `INSERT INTO customers (shopify_customer_id, email, credits)
     VALUES ($1, $2, 0)
     ON CONFLICT (shopify_customer_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, customers.email),
           updated_at = NOW()
     RETURNING *`,
    [shopifyCustomerId, email || null]
  );
  return rows[0];
}

export async function getCustomer(shopifyCustomerId: string): Promise<Customer | null> {
  const { rows } = await query<Customer>(
    `SELECT * FROM customers WHERE shopify_customer_id = $1`,
    [shopifyCustomerId]
  );
  return rows[0] || null;
}

export async function setCredits(
  shopifyCustomerId: string,
  credits: number,
  email?: string | null
): Promise<Customer> {
  if (credits < 0) throw new Error('Credits cannot be negative');
  await upsertCustomer(shopifyCustomerId, email);
  const { rows } = await query<Customer>(
    `UPDATE customers
     SET credits = $2, updated_at = NOW()
     WHERE shopify_customer_id = $1
     RETURNING *`,
    [shopifyCustomerId, credits]
  );
  return rows[0];
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
    const next = current.rows[0].credits + delta;
    if (next < 0) {
      throw new Error('Insufficient credits');
    }
    const updated = await client.query<Customer>(
      `UPDATE customers SET credits = $2, updated_at = NOW()
       WHERE shopify_customer_id = $1 RETURNING *`,
      [shopifyCustomerId, next]
    );
    await client.query('COMMIT');
    return updated.rows[0];
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
  return rows[0] || null;
}

export async function listCustomers(search?: string, limit = 100, offset = 0): Promise<Customer[]> {
  if (search) {
    const { rows } = await query<Customer>(
      `SELECT * FROM customers
       WHERE shopify_customer_id ILIKE $1 OR COALESCE(email, '') ILIKE $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    return rows;
  }
  const { rows } = await query<Customer>(
    `SELECT * FROM customers ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}
