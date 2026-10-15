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
  EGCC: "United Kingdom",
  EGPH: "United Kingdom",
  EGBB: "United Kingdom",
  EGSS: "United Kingdom",
  EGPF: "United Kingdom",
  EGGW: "United Kingdom",
  OMDB: "United Arab Emirates",
  RJTT: "Japan",
  LTFM: "Turkey",
  EDDF: "Germany",
  ESSA: "Sweden",
  ESGG: "Sweden",
  ESMS: "Sweden",
  ESSB: "Sweden",
  EFHK: "Finland",
  EFTP: "Finland",
  EFRO: "Finland",
  ENGM: "Norway",
  ENBR: "Norway",
  ENVA: "Norway",
  ENZV: "Norway",
  EETN: "Estonia",
  EVRA: "Latvia",
  EYVI: "Lithuania",
  EYKA: "Lithuania",
  EKBI: "Denmark",
  EKCH: "Denmark",
  EIDW: "Ireland",
  EICK: "Ireland",
  EINN: "Ireland",
};

export function regionFor(icao: string): string {
  return REGION_BY_ICAO[icao] ?? "Other";
}
