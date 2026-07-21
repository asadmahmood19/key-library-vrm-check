export interface VehicleSummary {
  vrm: string;
  vin: string | null;
  vinLast5: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  fuel: string | null;
  engineCc: number | null;
  body: string | null;
  transmission: string | null;
  dateFirstRegistered: string | null;
  taxStatus: string | null;
  taxDueDate: string | null;
}

function formatDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
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

export function summarizeVehicle(payload: Record<string, unknown>, vrm: string): VehicleSummary {
  const id = (payload.VehicleIdentification || {}) as Record<string, unknown>;
  const model = (payload.ModelData || {}) as Record<string, unknown>;
  const colour = (payload.ColourDetails || {}) as Record<string, unknown>;
  const body = (payload.BodyDetails || {}) as Record<string, unknown>;
  const tech = (payload.DvlaTechnicalDetails || {}) as Record<string, unknown>;
  const transmission = (payload.Transmission || {}) as Record<string, unknown>;
  const motTax = (payload.MotTaxStatus ||
    payload.TaxDetails ||
    payload.VehicleStatus ||
    {}) as Record<string, unknown>;

  return {
    vrm: String(id.Vrm || vrm),
    vin: pickString(id.Vin),
    vinLast5: pickString(id.VinLast5),
    make: pickString(model.Make, id.DvlaMake),
    model: pickString(model.Model, model.ModelVariant, id.DvlaModel),
    year: (id.YearOfManufacture as number) || null,
    colour: pickString(colour.CurrentColour),
    fuel: pickString(model.FuelType, id.DvlaFuelType),
    engineCc: (tech.EngineCapacityCc as number) || null,
    body: pickString(body.BodyStyle, id.DvlaBodyType),
    transmission: pickString(transmission.TransmissionType),
    dateFirstRegistered: formatDate(
      id.DateFirstRegistered || id.DateFirstRegisteredInUk
    ),
    taxStatus: pickString(
      motTax.TaxStatus,
      motTax.taxStatus,
      payload.TaxStatus,
      (payload as { taxStatus?: unknown }).taxStatus
    ),
    taxDueDate: formatDate(
      motTax.TaxDueDate ||
        motTax.taxDueDate ||
        payload.TaxDueDate ||
        (payload as { taxDueDate?: unknown }).taxDueDate
    ),
  };
}
