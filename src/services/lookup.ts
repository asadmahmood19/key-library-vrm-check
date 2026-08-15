import { query } from '../db';
import { getFreshCache, getOrFetchVehicle } from './cache';
import { CustomerProfile, deductOneCredit, upsertCustomer } from './credits';
import { summarizeVehicle, VehicleSummary } from './vehicleApi';
import { parseLookupQuery } from '../utils/vrm';

export interface LookupRow {
  id: string;
  shopify_customer_id: string;
  vrm: string;
  was_cached: boolean;
  payload: Record<string, unknown> | null;
  created_at: Date;
  email?: string | null;
  name?: string | null;
  company?: string | null;
}

export class LookupError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function performLookup(
  shopifyCustomerId: string,
  rawQuery: string,
  profile?: CustomerProfile | string | null
): Promise<{ vehicle: VehicleSummary; fromCache: boolean; creditsRemaining: number }> {
  let lookup;
  try {
    lookup = parseLookupQuery(rawQuery);
  } catch (err) {
    throw new LookupError(err instanceof Error ? err.message : 'Invalid registration or VIN');
  }

  const customer = await upsertCustomer(shopifyCustomerId, profile);
  const cached = await getFreshCache(lookup.value);

  if (!cached && customer.credits < 1) {
    throw new LookupError('No lookup credits remaining', 402);
  }

  let result;
  try {
    result = await getOrFetchVehicle(lookup);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vehicle lookup failed';
    throw new LookupError(message, 502);
  }

  const storeKey = result.cacheKey || lookup.value;

  if (result.fromCache) {
    await query(
      `INSERT INTO lookups (shopify_customer_id, vrm, was_cached, payload)
       VALUES ($1, $2, TRUE, $3::jsonb)`,
      [shopifyCustomerId, storeKey, JSON.stringify(result.payload)]
    );
    return {
      vehicle: result.summary,
      fromCache: true,
      creditsRemaining: customer.credits,
    };
  }

  const updated = await deductOneCredit(shopifyCustomerId);
  if (!updated) {
    throw new LookupError('No lookup credits remaining', 402);
  }

  await query(
    `INSERT INTO lookups (shopify_customer_id, vrm, was_cached, payload)
     VALUES ($1, $2, FALSE, $3::jsonb)`,
    [shopifyCustomerId, storeKey, JSON.stringify(result.payload)]
  );

  return {
    vehicle: result.summary,
    fromCache: false,
    creditsRemaining: updated.credits,
  };
}

export async function recentLookups(
  shopifyCustomerId: string,
  limit = 8
): Promise<
  Array<{
    id: string;
    vrm: string;
    was_cached: boolean;
    created_at: Date;
    vehicle: VehicleSummary | null;
  }>
> {
  const { rows } = await query<LookupRow>(
    `SELECT id, shopify_customer_id, vrm, was_cached, payload, created_at
     FROM (
       SELECT DISTINCT ON (vrm)
         id, shopify_customer_id, vrm, was_cached, payload, created_at
       FROM lookups
       WHERE shopify_customer_id = $1
       ORDER BY vrm, created_at DESC
     ) unique_lookups
     ORDER BY created_at DESC
     LIMIT $2`,
    [shopifyCustomerId, limit]
  );

  return rows.map((row) => ({
    id: String(row.id),
    vrm: row.vrm,
    was_cached: row.was_cached,
    created_at: row.created_at,
    vehicle: row.payload ? summarizeVehicle(row.payload, row.vrm) : null,
  }));
}

export async function listLookups(limit = 50, offset = 0): Promise<
  Array<
    LookupRow & {
      vehicle: VehicleSummary | null;
    }
  >
> {
  const { rows } = await query<LookupRow>(
    `SELECT
       l.id,
       l.shopify_customer_id,
       l.vrm,
       l.was_cached,
       l.payload,
       l.created_at,
       c.email,
       c.name,
       c.company
     FROM lookups l
     LEFT JOIN customers c ON c.shopify_customer_id = l.shopify_customer_id
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    vehicle: row.payload ? summarizeVehicle(row.payload, row.vrm) : null,
  }));
}

export async function countLookups(): Promise<number> {
  const { rows } = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM lookups`);
  return Number(rows[0]?.count || 0);
}
