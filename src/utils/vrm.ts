/** Normalize UK VRM: uppercase, strip spaces and non-alphanumerics. */
export function normalizeVrm(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function isValidVrm(vrm: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(vrm);
}
