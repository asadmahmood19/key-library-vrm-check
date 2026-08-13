import { config } from '../config';

export interface DvlaEnquiry {
  registrationNumber?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  [key: string]: unknown;
}

/**
 * DVLA Vehicle Enquiry Service — used only for Tax/MOT “existing data” fields.
 * Soft-fails (returns null) so a DVLA outage does not block CheckCarDetails lookups.
 */
export async function fetchDvlaEnquiry(registrationNumber: string): Promise<DvlaEnquiry | null> {
  const vrm = registrationNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!vrm) return null;

  try {
    const response = await fetch(config.dvlaApiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': config.dvlaApiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ registrationNumber: vrm }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`DVLA enquiry failed (${response.status}): ${text || response.statusText}`);
      return null;
    }

    return (await response.json()) as DvlaEnquiry;
  } catch (err) {
    console.warn('DVLA enquiry error', err);
    return null;
  }
}

export async function enrichPayloadWithDvla(
  payload: Record<string, unknown>,
  vrm: string
): Promise<Record<string, unknown>> {
  if (payload.DvlaEnquiry && typeof payload.DvlaEnquiry === 'object') {
    return payload;
  }
  const dvla = await fetchDvlaEnquiry(vrm);
  if (!dvla) return payload;
  return { ...payload, DvlaEnquiry: dvla };
}
