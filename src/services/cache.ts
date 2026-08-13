import { config } from '../config';
import { query } from '../db';
import { enrichPayloadWithDvla } from './dvla';
import { summarizeVehicle, VehicleSummary } from './vehicleApi';
import { LookupQuery } from '../utils/vrm';

export interface CacheEntry {
  vrm: string;
  payload: Record<string, unknown>;
  fetched_at: Date;
}

export async function getFreshCache(cacheKey: string): Promise<CacheEntry | null> {
  const { rows } = await query<CacheEntry>(
    `SELECT vrm, payload, fetched_at
     FROM vehicle_cache
     WHERE vrm = $1
       AND fetched_at >= NOW() - ($2::text || ' days')::interval`,
    [cacheKey, String(config.cacheDurationDays)]
  );
  return rows[0] || null;
}

export async function upsertCache(cacheKey: string, payload: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO vehicle_cache (vrm, payload, fetched_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (vrm) DO UPDATE
       SET payload = EXCLUDED.payload,
           fetched_at = NOW()`,
    [cacheKey, JSON.stringify(payload)]
  );
}

export async function fetchVehicleFromApi(lookup: LookupQuery): Promise<Record<string, unknown>> {
  const url = new URL(config.vehicleApiBaseUrl);
  url.searchParams.set('apikey', config.vehicleApiKey);
  if (lookup.kind === 'vin') {
    url.searchParams.set('vin', lookup.value);
  } else {
    url.searchParams.set('vrm', lookup.value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new Error(
        lookup.kind === 'vin'
          ? 'Vehicle with that VIN was not found'
          : 'Vehicle with that registration was not found'
      );
    }
    throw new Error(`Vehicle API error (${response.status}): ${text || response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    throw new Error('Vehicle API returned an invalid response');
  }
  return data;
}

function resolvedVrm(payload: Record<string, unknown>, fallback: string): string {
  const id = (payload.VehicleIdentification || {}) as Record<string, unknown>;
  const fromPayload = String(id.Vrm || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return fromPayload || fallback;
}

/** Fetch (or reuse cache), merge DVLA Tax/MOT, and write cache under VRM (+ VIN when used). */
export async function getOrFetchVehicle(lookup: LookupQuery): Promise<{
  summary: VehicleSummary;
  payload: Record<string, unknown>;
  fromCache: boolean;
  cacheKey: string;
}> {
  const cached = await getFreshCache(lookup.value);
  if (cached) {
    const vrm = resolvedVrm(cached.payload, cached.vrm);
    const payload = await enrichPayloadWithDvla(cached.payload, vrm);
    if (payload !== cached.payload) {
      await upsertCache(vrm, payload);
      if (lookup.kind === 'vin') await upsertCache(lookup.value, payload);
    }
    return {
      summary: summarizeVehicle(payload, vrm),
      payload,
      fromCache: true,
      cacheKey: vrm,
    };
  }

  const raw = await fetchVehicleFromApi(lookup);
  const vrm = resolvedVrm(raw, lookup.kind === 'vrm' ? lookup.value : '');
  if (!vrm && lookup.kind === 'vin') {
    // Still return VIN-based payload without DVLA if no VRM in response
    const payload = raw;
    await upsertCache(lookup.value, payload);
    return {
      summary: summarizeVehicle(payload, lookup.value),
      payload,
      fromCache: false,
      cacheKey: lookup.value,
    };
  }

  const payload = await enrichPayloadWithDvla(raw, vrm);
  await upsertCache(vrm, payload);
  if (lookup.kind === 'vin') {
    await upsertCache(lookup.value, payload);
  }

  return {
    summary: summarizeVehicle(payload, vrm),
    payload,
    fromCache: false,
    cacheKey: vrm,
  };
}
