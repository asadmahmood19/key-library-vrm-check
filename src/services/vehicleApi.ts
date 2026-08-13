export interface VehicleSummary {
  vrm: string;
  vin: string | null;
  vinLast5: string | null;
  make: string | null;
  model: string | null;
  year: number | string | null;
  modelGeneration: string | null;
  modelSeries: string | null;
  modelCode: string | null;
  modelStartDate: string | null;
  modelEndDate: string | null;
  vehicleType: string | null;
  taxStatus: string | null;
  taxDueDate: string | null;
  motStatus: string | null;
  motExpiryDate: string | null;
  engineModelCode: string | null;
  body: string | null;
  countryOfOrigin: string | null;
  colour: string | null;
  dateFirstRegistered: string | null;
  engineCc: number | string | null;
  engineManufacturer: string | null;
  numberOfGears: number | string | null;
  fuel: string | null;
  maximumPower: string | null;
  numberOfDoors: number | string | null;
  transmission: string | null;
  euroStatus: string | null;
  latestV5IssueDate: string | null;
}

function formatDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value);
  // Keep month/year forms like "4/2010" as-is
  if (/^\d{1,2}\/\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    return String(value);
  }
  return null;
}

function pickNumber(...values: unknown[]): number | string | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    return String(value);
  }
  return null;
}

function nested(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function latestV5Date(id: Record<string, unknown>): string | null {
  const dates = id.V5cCertificateIssueDates;
  if (Array.isArray(dates) && dates.length > 0) {
    return formatDate(dates[dates.length - 1]);
  }
  return formatDate(id.DateOfLastV5CIssued);
}

export function summarizeVehicle(payload: Record<string, unknown>, fallbackId: string): VehicleSummary {
  const id = (payload.VehicleIdentification || {}) as Record<string, unknown>;
  const model = (payload.ModelData || {}) as Record<string, unknown>;
  const colour = (payload.ColourDetails || {}) as Record<string, unknown>;
  const body = (payload.BodyDetails || {}) as Record<string, unknown>;
  const tech = (payload.DvlaTechnicalDetails || {}) as Record<string, unknown>;
  const transmission = (payload.Transmission || {}) as Record<string, unknown>;
  const smmt = (payload.SmmtDetails || {}) as Record<string, unknown>;
  const power = nested(payload, 'Performance', 'Power') as Record<string, unknown> | undefined;
  const ice = nested(payload, 'PowerSource', 'IceDetails') as Record<string, unknown> | undefined;
  const dvla = (payload.DvlaEnquiry || {}) as Record<string, unknown>;

  const bhp = pickNumber(power?.Bhp, power?.bhp);
  const maximumPower = bhp == null ? null : `${bhp} BHP`;

  return {
    vrm: String(id.Vrm || fallbackId),
    vin: pickString(id.Vin),
    vinLast5: pickString(id.VinLast5),
    make: pickString(id.DvlaMake, model.Make),
    model: pickString(id.DvlaModel, model.Model, model.ModelVariant),
    year: pickNumber(id.YearOfManufacture),
    modelGeneration: pickString(model.Mark),
    modelSeries: pickString(model.Series),
    modelCode: pickString(smmt.Series),
    modelStartDate: formatDate(model.StartDate),
    modelEndDate: formatDate(model.EndDate),
    vehicleType: pickString(model.VehicleClass),
    taxStatus: pickString(dvla.taxStatus, dvla.TaxStatus),
    taxDueDate: formatDate(dvla.taxDueDate || dvla.TaxDueDate),
    motStatus: pickString(dvla.motStatus, dvla.MotStatus),
    motExpiryDate: formatDate(dvla.motExpiryDate || dvla.MotExpiryDate),
    engineModelCode: pickString(ice?.EngineDescription, ice?.EngineCode),
    body: pickString(body.BodyStyle, id.DvlaBodyType),
    countryOfOrigin: pickString(model.CountryOfOrigin),
    colour: pickString(colour.CurrentColour),
    dateFirstRegistered: formatDate(id.DateFirstRegistered || id.DateFirstRegisteredInUk),
    engineCc: pickNumber(tech.EngineCapacityCc),
    engineManufacturer: pickString(ice?.EngineManufacturer),
    numberOfGears: pickNumber(transmission.NumberOfGears),
    fuel: pickString(model.FuelType, id.DvlaFuelType),
    maximumPower,
    numberOfDoors: pickNumber(body.NumberOfDoors),
    transmission: pickString(transmission.TransmissionType),
    euroStatus: pickString(model.EuroStatus, smmt.EuroStatus),
    latestV5IssueDate: latestV5Date(id),
  };
}
