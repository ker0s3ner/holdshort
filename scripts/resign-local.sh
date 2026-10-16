#!/usr/bin/env bash
# Re-signs the installed Holdshort.app with a free Apple Development
# certificate from Xcode (an Apple ID signed into Xcode, no paid Developer
# Program needed). A free personal-team certificate gives the app a real,
# stable signing identity - unlike the ad-hoc signature GitHub Actions
# builds it with - so macOS's permission system (TCC, e.g. the microphone)
# and the Dock keep treating it as the same app across launches. The
# tradeoff: a free-team certificate expires after 7 days, so this needs
# re-running weekly (just re-run it; it's quick, no rebuild needed).
#
# Prerequisites (one-time):
#   1. Xcode installed, signed into your Apple ID: Xcode > Settings >
#      Accounts > add your Apple ID.
#   2. That Apple ID has generated a free "Apple Development" certificate -
#      Xcode does this automatically once it's signed in and you've built
#      or signed anything with that account.
#
# Usage: scripts/resign-local.sh [/path/to/Holdshort.app]
set -euo pipefail

# Guards against two runs overlapping (e.g. the hourly LaunchAgent firing
# while someone's running this by hand) - a concurrent codesign on the same
# bundle is what produces the stray .cstemp files handled below in the
# first place. mkdir is atomic, so it doubles as a portable lock (no
# flock on macOS).
LOCK_DIR="/tmp/holdshort-resign.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another resign is already running - skipping." >&2
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

APP_PATH="${1:-/Applications/Holdshort.app}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "No app found at $APP_PATH - pass the path as an argument if it's installed elsewhere." >&2
  exit 1
fi

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep "Apple Development" | head -1 | sed -E 's/.*"(.*)"/\1/')

if [[ -z "$IDENTITY" ]]; then
  echo "No 'Apple Development' signing identity found in your keychain." >&2
  echo "Open Xcode > Settings > Accounts, add your Apple ID, then open any" >&2
  echo "project and build it once (File > New > Project is fine) so Xcode" >&2
  echo "generates the certificate, then re-run this script." >&2
  exit 1
fi

# A codesign run that gets interrupted (the Mac sleeping mid-sign, two
# triggers overlapping) can leave its own ".cstemp" scratch files behind
# inside the bundle - codesign then chokes on those as if they were real
# Mach-O components on the next run ("invalid or unsupported format").
find "$APP_PATH" -name "*.cstemp" -delete

echo "Signing with: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" "$APP_PATH"
codesign -dv "$APP_PATH"
echo "Done. $APP_PATH is now signed with your Apple Development certificate (valid ~7 days)."
