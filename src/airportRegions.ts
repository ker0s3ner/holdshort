/** Groups bundled airports into regions, mirroring the ARTCC-then-facility
 * picker pattern - a flat picker doesn't scale once there are more than a
 * handful of airports. */
export const REGION_BY_ICAO: Record<string, string> = {
  KBUR: "United States",
  KJFK: "United States",
  KATL: "United States",
  KDFW: "United States",
  KORD: "United States",
  KLAX: "United States",
  EGKK: "United Kingdom",
  EGLL: "United Kingdom",
  OMDB: "United Arab Emirates",
  RJTT: "Japan",
  LTFM: "Turkey",
  EDDF: "Germany",
};

export function regionFor(icao: string): string {
  return REGION_BY_ICAO[icao] ?? "Other";
}
