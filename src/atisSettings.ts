/** ATIS info is the controller's own broadcast - an identifier letter plus
 * free-text remarks - not simulated audio, just the record of what's
 * currently being broadcast. Kept per-airport since it means something
 * different at each one. */
function letterKey(icao: string): string {
  return `holdshort.atis.${icao}.letter`;
}
function remarksKey(icao: string): string {
  return `holdshort.atis.${icao}.remarks`;
}
function qnhKey(icao: string): string {
  return `holdshort.atis.${icao}.qnh`;
}

export function getAtisLetter(icao: string): string {
  try {
    return localStorage.getItem(letterKey(icao)) || "A";
  } catch {
    return "A";
  }
}

export function setAtisLetter(icao: string, letter: string) {
  try {
    localStorage.setItem(letterKey(icao), letter);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}

export function nextAtisLetter(letter: string): string {
  const code = letter.charCodeAt(0) - 65;
  return String.fromCharCode(((code + 1) % 26) + 65);
}

export function getAtisRemarks(icao: string): string {
  try {
    return localStorage.getItem(remarksKey(icao)) || "";
  } catch {
    return "";
  }
}

export function setAtisRemarks(icao: string, text: string) {
  try {
    localStorage.setItem(remarksKey(icao), text);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}

/** Empty string means "not manually overridden - use whatever the current
 * METAR's altimeter group says". */
export function getAtisQnh(icao: string): string {
  try {
    return localStorage.getItem(qnhKey(icao)) || "";
  } catch {
    return "";
  }
}

export function setAtisQnh(icao: string, qnh: string) {
  try {
    localStorage.setItem(qnhKey(icao), qnh);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}
