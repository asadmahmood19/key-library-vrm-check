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

function currentVin(payload: Record<string, unknown>): string | null {
  const id = (payload.VehicleIdentification || {}) as Record<string, unknown>;
  return typeof id.Vin === 'string' ? id.Vin : null;
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

/**
 * vehiclespecs returns a masked Vin (e.g. *************5561).
 * carhistorycheck returns the full VIN under VehicleRegistration.Vin.
 * Soft-fails so a history-check outage does not block the main lookup.
 */
async function fetchFullVinFromHistory(lookup: LookupQuery): Promise<string | null> {
  try {
    const url = new URL(config.carHistoryCheckUrl);
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
      console.warn(`carhistorycheck failed (${response.status}): ${text || response.statusText}`);
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const reg = (data.VehicleRegistration || {}) as Record<string, unknown>;
    if (isFullVin(reg.Vin)) return String(reg.Vin).toUpperCase();
    return null;
  } catch (err) {
    console.warn('carhistorycheck error', err);
    return null;
  }
}

export async function enrichPayloadWithFullVin(
  payload: Record<string, unknown>,
  lookup: LookupQuery
): Promise<Record<string, unknown>> {
  if (isFullVin(currentVin(payload))) return payload;

  // If lookup itself was a full VIN, prefer that.
  if (lookup.kind === 'vin' && isFullVin(lookup.value)) {
    const id = { ...((payload.VehicleIdentification || {}) as Record<string, unknown>), Vin: lookup.value };
    return { ...payload, VehicleIdentification: id };
  }

  const fullVin = await fetchFullVinFromHistory(lookup);
  if (!fullVin) return payload;

  const id = {
    ...((payload.VehicleIdentification || {}) as Record<string, unknown>),
    Vin: fullVin,
  };
  return { ...payload, VehicleIdentification: id };
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

/** Fetch (or reuse cache), merge full VIN + DVLA Tax/MOT, and write cache under VRM (+ VIN when used). */
export async function getOrFetchVehicle(lookup: LookupQuery): Promise<{
  summary: VehicleSummary;
  payload: Record<string, unknown>;
  fromCache: boolean;
  cacheKey: string;
}> {
  const cached = await getFreshCache(lookup.value);
  if (cached) {
    const vrm = resolvedVrm(cached.payload, cached.vrm);
    let payload = cached.payload;
    const beforeVin = currentVin(payload);
    payload = await enrichPayloadWithFullVin(payload, lookup);
    payload = await enrichPayloadWithDvla(payload, vrm);
    if (payload !== cached.payload || currentVin(payload) !== beforeVin) {
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

  let payload = await enrichPayloadWithFullVin(raw, lookup);
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
