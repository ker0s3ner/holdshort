export type Theme = "holdshort" | "crc" | "euroscope";

const THEME_KEY = "holdshort.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "crc" || v === "euroscope" || v === "holdshort") return v;
    return "holdshort";
  } catch {
    return "holdshort";
  }
}

/** Applies the theme to the document root (a CSS [data-theme] selector)
 * and remembers it. Only the app's own chrome (top bar, panels, buttons)
 * is themed this way - the SMR/Tower Cab canvas rendering has its own
 * hardcoded colors and isn't affected yet. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable - setting just won't persist.
  }
  document.documentElement.setAttribute("data-theme", theme);
}

/** Call once on app startup to apply whatever theme was last saved. */
export function applyStoredTheme() {
  document.documentElement.setAttribute("data-theme", getTheme());
}
