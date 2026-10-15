import type { ControllerRole } from "./types";

export interface Profile {
  id: string;
  name: string;
  icao: string;
  role: ControllerRole;
  displayType: "smr" | "tower";
}

const STORAGE_KEY = "holdshort.profiles";

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: Profile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Private window / storage disabled - profiles just won't persist.
  }
}

export function createProfile(data: Omit<Profile, "id">): Profile {
  const profile: Profile = { ...data, id: crypto.randomUUID() };
  saveProfiles([...loadProfiles(), profile]);
  return profile;
}

export function duplicateProfile(id: string): Profile | null {
  const profiles = loadProfiles();
  const source = profiles.find((p) => p.id === id);
  if (!source) return null;
  const copy: Profile = { ...source, id: crypto.randomUUID(), name: `${source.name} copy` };
  saveProfiles([...profiles, copy]);
  return copy;
}

export function deleteProfile(id: string) {
  saveProfiles(loadProfiles().filter((p) => p.id !== id));
}

export function importProfile(json: string): Profile {
  const data = JSON.parse(json);
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: String(data.name ?? "Imported profile"),
    icao: String(data.icao ?? ""),
    role: (data.role ?? "ground") as ControllerRole,
    displayType: data.displayType === "tower" ? "tower" : "smr",
  };
  saveProfiles([...loadProfiles(), profile]);
  return profile;
}

export function exportProfile(profile: Profile) {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${profile.name.replace(/[^a-z0-9-_]+/gi, "_")}.holdshort-profile.json`;
  a.click();
  URL.revokeObjectURL(url);
}
