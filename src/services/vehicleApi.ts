export interface VehicleSummary {
  vrm: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  fuel: string | null;
  engineCc: number | null;
  body: string | null;
  transmission: string | null;
  vinLast5: string | null;
}

export function summarizeVehicle(payload: Record<string, unknown>, vrm: string): VehicleSummary {
  const id = (payload.VehicleIdentification || {}) as Record<string, unknown>;
  const model = (payload.ModelData || {}) as Record<string, unknown>;
  const colour = (payload.ColourDetails || {}) as Record<string, unknown>;
  const body = (payload.BodyDetails || {}) as Record<string, unknown>;
  const tech = (payload.DvlaTechnicalDetails || {}) as Record<string, unknown>;
  const transmission = (payload.Transmission || {}) as Record<string, unknown>;

  return {
    vrm: String(id.Vrm || vrm),
    make: (model.Make as string) || (id.DvlaMake as string) || null,
    model:
      (model.Model as string) ||
      (model.ModelVariant as string) ||
      (id.DvlaModel as string) ||
      null,
    year: (id.YearOfManufacture as number) || null,
    colour: (colour.CurrentColour as string) || null,
    fuel: (model.FuelType as string) || (id.DvlaFuelType as string) || null,
    engineCc: (tech.EngineCapacityCc as number) || null,
    body: (body.BodyStyle as string) || (id.DvlaBodyType as string) || null,
    transmission: (transmission.TransmissionType as string) || null,
    vinLast5: (id.VinLast5 as string) || null,
  };
}
