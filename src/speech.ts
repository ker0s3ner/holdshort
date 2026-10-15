/** Makes TTS text actually sound like ATC radio instead of a generic text
 * reader: digits spoken individually ("two three eight eight", not "two
 * thousand three hundred eighty-eight"), identifier letters spelled NATO
 * phonetic ("alpha", not a dropped or mispronounced single letter), and
 * airline callsign prefixes spoken as their real telephony name
 * ("American", not "A A L"). Shared by both controller readbacks
 * (voice.ts) and pilot-initiated calls (pilotCalls.ts) so every voice in
 * the sim is consistent. */

const NATO: Record<string, string> = {
  A: "alpha",
  B: "bravo",
  C: "charlie",
  D: "delta",
  E: "echo",
  F: "foxtrot",
  G: "golf",
  H: "hotel",
  I: "india",
  J: "juliett",
  K: "kilo",
  L: "lima",
  M: "mike",
  N: "november",
  O: "oscar",
  P: "papa",
  Q: "quebec",
  R: "romeo",
  S: "sierra",
  T: "tango",
  U: "uniform",
  V: "victor",
  W: "whiskey",
  X: "x-ray",
  Y: "yankee",
  Z: "zulu",
};

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** ICAO airline code -> the name actually spoken on the radio. Kept in
 * sync with the airline pools in crates/atc-core/src/traffic.rs. */
const AIRLINES: Record<string, string> = {
  AAL: "American",
  UAL: "United",
  DAL: "Delta",
  SWA: "Southwest",
  JBU: "JetBlue",
  ASA: "Alaska",
  FFT: "Frontier",
  SKW: "SkyWest",
  RYR: "Ryanair",
  EZY: "EasyJet",
  BAW: "Speedbird",
  DLH: "Lufthansa",
  AFR: "Air France",
  KLM: "KLM",
  SAS: "Scandinavian",
  FIN: "Finnair",
  WZZ: "Wizz Air",
  NAX: "Norwegian",
  EIN: "Shamrock",
  VLG: "Vueling",
  THY: "Turkish",
  PGT: "Sunturk",
  UAE: "Emirates",
  ETD: "Etihad",
  FDB: "Flydubai",
  ANA: "All Nippon",
  JAL: "Japan Air",
  SKY: "Skymark",
};

function spellDigits(digits: string): string {
  return digits
    .split("")
    .map((d) => DIGIT_WORDS[Number(d)] ?? d)
    .join(" ");
}

function spellLetters(letters: string): string {
  return letters
    .split("")
    .map((l) => NATO[l.toUpperCase()] ?? l)
    .join(" ");
}

/** Splits a mixed token like "07R" or "A3" into its letter/digit runs and
 * spells each the way it's actually read on frequency. */
function spellIdentifier(token: string): string {
  const parts: string[] = [];
  let buf = "";
  let bufIsDigit: boolean | null = null;
  for (const ch of token) {
    const isDigit = /[0-9]/.test(ch);
    if (bufIsDigit === null || isDigit === bufIsDigit) {
      buf += ch;
      bufIsDigit = isDigit;
    } else {
      parts.push(bufIsDigit ? spellDigits(buf) : spellLetters(buf));
      buf = ch;
      bufIsDigit = isDigit;
    }
  }
  if (buf) parts.push(bufIsDigit ? spellDigits(buf) : spellLetters(buf));
  return parts.join(" ");
}

/** A callsign like "AAL2388" becomes "American two three eight eight";
 * an unrecognized prefix (GA-style registrations etc.) gets spelled out
 * phonetically instead of silently mispronounced. */
export function spellCallsign(callsign: string): string {
  const match = callsign.match(/^([A-Z]{3})(\d+)$/);
  if (match) {
    const [, prefix, digits] = match;
    const airline = AIRLINES[prefix];
    if (airline) return `${airline} ${spellDigits(digits)}`;
  }
  return spellIdentifier(callsign);
}

/** Rewrites every alphanumeric identifier found in free text (runway
 * numbers, taxiway/gate refs, flight numbers) so a generic TTS voice reads
 * them the ATC way instead of guessing at a plain number. */
export function humanizeRadioText(text: string): string {
  return text.replace(/[A-Za-z]*\d+[A-Za-z]*/g, (token) => spellIdentifier(token));
}

/** Builds the full spoken line for a radio call: the callsign spelled
 * properly, followed by the rest of the message with its own identifiers
 * humanized. */
export function spokenLine(callsign: string, message: string): string {
  return `${spellCallsign(callsign)}, ${humanizeRadioText(message)}.`;
}

const NOVELTY_VOICE_NAMES = new Set([
  "Albert",
  "Bad News",
  "Bahh",
  "Bells",
  "Boing",
  "Bubbles",
  "Cellos",
  "Deranged",
  "Good News",
  "Hysterical",
  "Jester",
  "Organ",
  "Pipe Organ",
  "Trinoids",
  "Whisper",
  "Zarvox",
  "Wobble",
  "Fred",
  "Junior",
  "Ralph",
  "Kathy",
  "Princess",
  "Rocko",
  "Grandma",
  "Grandpa",
  "Eddy",
  "Flo",
  "Reed",
  "Sandy",
  "Shelley",
]);

/** Filters out the novelty/comedic system voices (Zarvox, Bubbles, Organ,
 * etc.) that make radio calls sound like a joke instead of a pilot. */
export function isRealisticVoice(voice: SpeechSynthesisVoice): boolean {
  const base = voice.name.replace(/\s*\(.*\)\s*$/, "").trim();
  return !NOVELTY_VOICE_NAMES.has(base);
}
