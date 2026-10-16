/** Plugins toggled from Settings → Plugins. Each one is a static HTML
 * file (see src/pluginProtocol.ts) running in a sandboxed iframe via
 * PluginHost - a real, if deliberately read-only, third-party plugin
 * runtime rather than built-in extras pretending to be plugins. There's
 * no install-from-URL flow yet (that's a trust/distribution problem of
 * its own), so for now the list is just what ships in public/plugins/. */
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  /** Path to the plugin's HTML entry point, served from public/. */
  entry: string;
}

export const AVAILABLE_PLUGINS: PluginInfo[] = [
  {
    id: "worldmap",
    name: "World Traffic Map",
    description:
      "A VatSpy-style world map showing where each aircraft in your current session is really " +
      "flying to or from. This only knows about traffic in your own local sim - there's no shared " +
      "network connecting separate Holdshort sessions together, so it can't show other players.",
    entry: "/plugins/worldmap/index.html",
  },
];

function key(id: string): string {
  return `holdshort.plugin.${id}.enabled`;
}

export function isPluginEnabled(id: string): boolean {
  try {
    return localStorage.getItem(key(id)) === "true";
  } catch {
    return false;
  }
}

export function setPluginEnabled(id: string, enabled: boolean) {
  try {
    localStorage.setItem(key(id), String(enabled));
  } catch {
    // Storage unavailable - setting just won't persist.
  }
}
