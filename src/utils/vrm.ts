/** Normalize UK VRM / VIN: uppercase, strip spaces and non-alphanumerics. */
export function normalizeLookupQuery(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** @deprecated Prefer normalizeLookupQuery */
export function normalizeVrm(input: string): string {
  return normalizeLookupQuery(input);
}

export function isVin(value: string): boolean {
  // ISO 3779 VIN: 17 chars, excludes I, O, Q
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
}

export function isValidVrm(vrm: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(vrm);
}

export type LookupQuery =
  | { kind: 'vrm'; value: string }
  | { kind: 'vin'; value: string };

export function parseLookupQuery(input: string): LookupQuery {
  const value = normalizeLookupQuery(input);
  if (isVin(value)) return { kind: 'vin', value };
  if (isValidVrm(value)) return { kind: 'vrm', value };
  throw new Error('Enter a valid UK registration (VRM) or 17-character VIN');
}
