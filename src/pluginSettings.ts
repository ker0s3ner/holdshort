/** Built-in "plugins" - optional extras, off by default, toggled from
 * Settings → Plugins. There's no sandboxed runtime for loading third-party
 * plugin code yet (that's a real engineering project of its own - running
 * untrusted code safely), so for now this is a small set of built-in
 * extras behind the same toggle pattern a community plugin system would
 * use, rather than a fake "install from URL" box that doesn't do anything. */
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
}

export const AVAILABLE_PLUGINS: PluginInfo[] = [
  {
    id: "worldmap",
    name: "World Traffic Map",
    description:
      "A VatSpy-style world map showing where each aircraft in your current session is really " +
      "flying to or from. This only knows about traffic in your own local sim - there's no shared " +
      "network connecting separate Holdshort sessions together, so it can't show other players.",
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
