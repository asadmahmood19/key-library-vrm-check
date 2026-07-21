import { config } from '../config';
import { query } from '../db';
import { summarizeVehicle, VehicleSummary } from './vehicleApi';

export interface CacheEntry {
  vrm: string;
  payload: Record<string, unknown>;
  fetched_at: Date;
}

export async function getFreshCache(vrm: string): Promise<CacheEntry | null> {
  const { rows } = await query<CacheEntry>(
    `SELECT vrm, payload, fetched_at
     FROM vehicle_cache
     WHERE vrm = $1
       AND fetched_at >= NOW() - ($2::text || ' days')::interval`,
    [vrm, String(config.cacheDurationDays)]
  );
  return rows[0] || null;
}

export async function upsertCache(vrm: string, payload: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO vehicle_cache (vrm, payload, fetched_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (vrm) DO UPDATE
       SET payload = EXCLUDED.payload,
           fetched_at = NOW()`,
    [vrm, JSON.stringify(payload)]
  );
}

export async function fetchVehicleFromApi(vrm: string): Promise<Record<string, unknown>> {
  const url = new URL(config.vehicleApiBaseUrl);
  url.searchParams.set('apikey', config.vehicleApiKey);
  url.searchParams.set('vrm', vrm);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Vehicle API error (${response.status}): ${text || response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    throw new Error('Vehicle API returned an invalid response');
  }
  return data;
}

export async function getOrFetchVehicle(
  vrm: string
): Promise<{ summary: VehicleSummary; payload: Record<string, unknown>; fromCache: boolean }> {
  const cached = await getFreshCache(vrm);
  if (cached) {
    return {
      summary: summarizeVehicle(cached.payload, vrm),
      payload: cached.payload,
      fromCache: true,
    };
  }

  const payload = await fetchVehicleFromApi(vrm);
  await upsertCache(vrm, payload);
  return {
    summary: summarizeVehicle(payload, vrm),
    payload,
    fromCache: false,
  };
}
