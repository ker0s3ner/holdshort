/** Pulls the pieces a real ATIS broadcast reads out of a raw METAR string,
 * so the ATIS panel can fill itself in instead of asking the controller to
 * retype the weather by hand. Best-effort regex parsing of standard ICAO
 * METAR groups - not a full METAR grammar, just the groups an ATIS reads. */
export interface ParsedMetar {
  wind: string | null;
  visibility: string | null;
  clouds: string | null;
  tempDew: string | null;
  /** Altimeter in whole hectopascals, however the METAR expressed it
   * (Qnnnn directly, Annnn converted from inches of mercury). */
  qnhHpa: number | null;
}

export function parseMetar(metar: string): ParsedMetar {
  const wind = metar.match(/\b(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT\b/)?.[0] ?? null;
  const visibility = metar.match(/\b(?:\d{4}|\d+SM|CAVOK)\b/)?.[0] ?? null;
  const clouds = metar.match(/\b(?:FEW|SCT|BKN|OVC)\d{3}\b/g)?.join(" ") ??
    (metar.includes("CLR") ? "CLR" : metar.includes("SKC") ? "SKC" : null);
  const tempDew = metar.match(/\bM?\d{2}\/M?\d{2}\b/)?.[0] ?? null;

  let qnhHpa: number | null = null;
  const qMatch = metar.match(/\bQ(\d{4})\b/);
  const aMatch = metar.match(/\bA(\d{4})\b/);
  if (qMatch) {
    qnhHpa = Number(qMatch[1]);
  } else if (aMatch) {
    qnhHpa = Math.round((Number(aMatch[1]) / 100) * 33.8639);
  }

  return { wind, visibility, clouds, tempDew, qnhHpa };
}

export interface AtisInput {
  icao: string;
  letter: string;
  activeRunway: { ref: string; end: string } | null;
  metar: string | null;
  qnh: string;
  remarks: string;
  towerName: string;
}

/** Builds the broadcast text the way a real ATIS reads it out, in the same
 * shape as the controller-facing printout: identification, runways in use,
 * weather, altimeter, transition level, acknowledgement instruction. */
export function generateAtisText(input: AtisInput): string {
  const now = new Date();
  const time = `${String(now.getUTCHours()).padStart(2, "0")}${String(
    now.getUTCMinutes()
  ).padStart(2, "0")}Z`;

  const parsed = input.metar ? parseMetar(input.metar) : null;
  const rwy = input.activeRunway?.end ?? "---";

  const weatherLine = [
    parsed?.wind ?? "WIND NOT AVAILABLE",
    parsed?.visibility ?? "",
    parsed?.clouds ?? "",
    parsed?.tempDew ?? "",
    input.qnh ? `Q${input.qnh}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    `${input.icao} ATIS INFO ${input.letter} TIME ${time}`,
    `DEP RWY ${rwy}  ARR RWY ${rwy}`,
    weatherLine,
    ...(input.remarks.trim() ? [input.remarks.trim().toUpperCase()] : []),
    `ACKNOWLEDGE RECEIPT OF INFORMATION ${input.letter}`,
    `AND ADVISE AIRCRAFT TYPE ON FIRST CONTACT${input.towerName ? ` WITH ${input.towerName.toUpperCase()}` : ""}`,
    `END OF INFORMATION ${input.letter}`,
  ];
  return lines.join("\n");
}
