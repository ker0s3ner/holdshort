import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status = "idle" | "checking" | "available" | "installing" | "error";

/** Checks GitHub releases for a newer signed build on launch. The user
 * never has to re-download a DMG by hand after the first install. */
export function UpdateBanner() {
  const [status, setStatus] = useState<Status>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("checking");
    check()
      .then((found) => {
        if (found) {
          setUpdate(found);
          setStatus("available");
        } else {
          setStatus("idle");
        }
      })
      .catch((e) => {
        setError(String(e));
        setStatus("error");
      });
  }, []);

  const install = async () => {
    if (!update) return;
    setStatus("installing");
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  if (status === "available" && update) {
    return (
      <div className="update-banner">
        <span>Update {update.version} is available (you're on {update.currentVersion}).</span>
        <button onClick={install}>Download &amp; Install</button>
      </div>
    );
  }
  if (status === "installing") {
    return <div className="update-banner">Installing update, app will relaunch…</div>;
  }
  if (status === "error" && error) {
    return <div className="update-banner error">Update check failed: {error}</div>;
  }
  return null;
}
