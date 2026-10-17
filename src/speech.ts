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

/** A trailing single letter on a flight-number callsign is the ICAO wake
 * turbulence category, not a letter to spell out - "H" means "heavy" and
 * "J" means "super", said as that word, never "hotel"/"juliett". */
const WEIGHT_CATEGORY: Record<string, string> = { H: "heavy", J: "super" };

/** A callsign like "AAL2388" becomes "American two three eight eight",
 * and "AAL2356H" becomes "American two three five six heavy". An
 * unrecognized prefix (GA-style registrations etc.) gets spelled out
 * phonetically instead of silently mispronounced. */
export function spellCallsign(callsign: string): string {
  const match = callsign.match(/^([A-Z]{3})(\d+)([A-Z]?)$/);
  if (match) {
    const [, prefix, digits, suffix] = match;
    const airline = AIRLINES[prefix];
    if (airline) {
      const base = `${airline} ${spellDigits(digits)}`;
      if (!suffix) return base;
      const weightWord = WEIGHT_CATEGORY[suffix];
      return weightWord ? `${base} ${weightWord}` : `${base} ${spellLetters(suffix)}`;
    }
  }
  return spellIdentifier(callsign);
}

/** Finds which of the given callsigns a pilot's transmission was actually
 * addressed to, e.g. "United 6806 heavy, pushback approved, tail right"
 * -> "UAL6806H" - matching on the airline's telephony name plus the flight
 * number, the same pieces spellCallsign() reads them out as, rather than
 * requiring the controller to click-select the aircraft before every
 * transmission. Real ATC clearances always restate the callsign; this is
 * just undoing spellCallsign() well enough to resolve it.
 *
 * Tries an exact airline-name + digit-substring match first (cheap, zero
 * false positives), then falls back to the accent/transcription-tolerant
 * fuzzy matcher so a thick accent or a whisper slip ("Jet Blue two tree
 * ate ate") still resolves. */
export function matchSpokenCallsign(text: string, callsigns: string[]): string | null {
  const lower = text.toLowerCase();
  for (const callsign of callsigns) {
    const match = callsign.match(/^([A-Z]{3})(\d+)([A-Z]?)$/);
    if (!match) continue;
    const [, prefix, digits] = match;
    const airline = AIRLINES[prefix];
    if (!airline) continue;
    if (lower.includes(airline.toLowerCase()) && lower.includes(digits)) {
      return callsign;
    }
  }
  return fuzzyMatchCallsign(text, callsigns);
}

/** Digit words whisper (or a pilot) might say instead of bare digits,
 * including the aviation "niner" and the "oh" people use for zero. */
const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
};

/** Rewrites spelled-out digit runs into actual digits, collapsing a run of
 * adjacent digit words into one number: "flight level one eight zero" ->
 * "flight level 180", "heading two seven zero" -> "heading 270", while
 * leaving "five thousand" as "5 thousand" for the word-aware altitude
 * parser. Any already-numeric tokens are preserved and merged into an
 * adjacent spoken run too ("two 50" -> "250"). */
export function wordsToDigits(text: string): string {
  const tokens = text.toLowerCase().split(/\s+/);
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run) {
      out.push(run);
      run = "";
    }
  };
  for (const token of tokens) {
    const clean = token.replace(/[.,]/g, "");
    if (clean in SPOKEN_DIGITS) {
      run += SPOKEN_DIGITS[clean];
    } else if (/^\d+$/.test(clean)) {
      run += clean;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(" ");
}

/** Crude character-overlap similarity (Sørensen-Dice over bigrams), 0..1 -
 * good enough to tell "jet blue" from "jetblue"/"jat blue" without pulling
 * in a Levenshtein dependency. */
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const grams = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    return grams;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, countA] of ga) {
    const countB = gb.get(g);
    if (countB) overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Accent/transcription-tolerant callsign resolver. Normalizes spelled-out
 * digits, then scores every active callsign on how well its airline
 * telephony name and flight number appear in the transcript, picking the
 * best over a confidence floor. Tolerates a misheard airline name (fuzzy,
 * not exact) and a flight number that's off by a digit, which is exactly
 * what a thick accent or a short noisy clip produces. Returns null rather
 * than guessing when nothing is close enough. */
export function fuzzyMatchCallsign(text: string, callsigns: string[]): string | null {
  const normalized = wordsToDigits(text).toLowerCase();
  const digitRuns = normalized.match(/\d+/g) ?? [];
  const words = normalized.split(/[^a-z]+/).filter(Boolean);

  let best: string | null = null;
  let bestScore = 0;

  for (const callsign of callsigns) {
    const match = callsign.match(/^([A-Z]{3})(\d+)([A-Z]?)$/);
    if (!match) {
      // Non-airline registration: only an exact (normalized) hit counts.
      if (normalized.replace(/\s+/g, "").includes(callsign.toLowerCase())) {
        return callsign;
      }
      continue;
    }
    const [, prefix, digits] = match;
    const airline = (AIRLINES[prefix] ?? prefix).toLowerCase();
    const airlineWords = airline.split(/\s+/);

    // Airline-name score: best fuzzy hit of any airline word against any
    // spoken word (handles "jat"/"jet", "united"->"united", splits like
    // "jet blue").
    let nameScore = 0;
    for (const aw of airlineWords) {
      for (const w of words) {
        nameScore = Math.max(nameScore, diceSimilarity(aw, w));
      }
    }
    // Also try the whole collapsed name against the collapsed transcript.
    nameScore = Math.max(nameScore, normalized.includes(airline) ? 1 : 0);

    // Flight-number score: exact digit-run hit is strongest; otherwise the
    // closest run by similarity (off-by-one digit still scores high).
    let numScore = 0;
    for (const run of digitRuns) {
      if (run === digits) {
        numScore = 1;
        break;
      }
      numScore = Math.max(numScore, diceSimilarity(run, digits));
    }

    // Require some evidence of both the airline and the number; weight the
    // number more, since it's the disambiguator between same-airline flights.
    if (nameScore < 0.4 || numScore < 0.4) continue;
    const score = nameScore * 0.4 + numScore * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = callsign;
    }
  }
  return bestScore >= 0.55 ? best : null;
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

/** Common high-quality English voices, checked in this order. Used only
 * when the user hasn't picked one in Settings - leaving utter.voice unset
 * lets the browser/OS pick ITS OWN default, which on macOS can land on a
 * novelty "sung" voice (Bells, Reed, Cellos...) depending on what's set in
 * Accessibility > Spoken Content, not necessarily anything realistic. */
const PREFERRED_DEFAULT_NAMES = ["Ava", "Samantha", "Nathan", "Evan", "Zoe", "Allison", "Alex"];

/** Picks a sensible default voice from the realistic subset when the user
 * hasn't explicitly chosen one, instead of leaving it to engine/OS defaults
 * that can land on a novelty voice. */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const realistic = voices.filter(isRealisticVoice);
  for (const name of PREFERRED_DEFAULT_NAMES) {
    const match = realistic.find((v) => v.name.startsWith(name));
    if (match) return match;
  }
  return realistic.find((v) => v.lang.startsWith("en")) ?? realistic[0];
}

/** Resolves the voice to actually speak with: the user's explicit Settings
 * choice if they made one, otherwise a sane realistic default rather than
 * whatever the engine falls back to on its own. */
export function resolveVoice(voiceName: string): SpeechSynthesisVoice | undefined {
  if (!("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (voiceName) {
    const chosen = voices.find((v) => v.name === voiceName);
    if (chosen) return chosen;
  }
  return pickDefaultVoice(voices);
}
