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

function isFullVin(value: unknown): value is string {
  return typeof value === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
}

/** If the user searched by VIN, keep that full VIN on the payload (vehiclespecs often masks Vin). */
function applyLookupVin(
  payload: Record<string, unknown>,
  lookup: LookupQuery
): Record<string, unknown> {
  if (lookup.kind !== 'vin' || !isFullVin(lookup.value)) return payload;
  const id = {
    ...((payload.VehicleIdentification || {}) as Record<string, unknown>),
    Vin: lookup.value,
  };
  return { ...payload, VehicleIdentification: id };
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

async function persistCache(
  payload: Record<string, unknown>,
  vrm: string,
  lookup: LookupQuery
): Promise<void> {
  if (vrm) await upsertCache(vrm, payload);
  if (lookup.kind === 'vin') await upsertCache(lookup.value, payload);
}

/** Fetch vehiclespecs only (+ DVLA Tax/MOT). Never calls carhistorycheck. */
export async function getOrFetchVehicle(lookup: LookupQuery): Promise<{
  summary: VehicleSummary;
  payload: Record<string, unknown>;
  fromCache: boolean;
  cacheKey: string;
}> {
  const cached = await getFreshCache(lookup.value);
  if (cached) {
    const vrm = resolvedVrm(cached.payload, cached.vrm);
    let payload = applyLookupVin(cached.payload, lookup);
    payload = await enrichPayloadWithDvla(payload, vrm);
    if (payload !== cached.payload) {
      await persistCache(payload, vrm, lookup);
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

  let payload = applyLookupVin(raw, lookup);
  if (vrm) {
    payload = await enrichPayloadWithDvla(payload, vrm);
  }

  const cacheKey = vrm || lookup.value;
  await persistCache(payload, cacheKey, lookup);

  return {
    summary: summarizeVehicle(payload, cacheKey),
    payload,
    fromCache: false,
    cacheKey,
  };
}
