#!/usr/bin/env bash
# Cuts a new release: bumps the version everywhere it needs to match,
# commits, tags, and pushes. The GitHub Actions workflow
# (.github/workflows/release.yml) picks up the tag, builds a signed DMG,
# and publishes it plus latest.json so installed apps auto-update.
#
# Usage: scripts/release.sh 0.2.0
set -euo pipefail

VERSION="${1:?Usage: scripts/release.sh <version, e.g. 0.2.0>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

node -e "
  const fs = require('fs');
  const path = 'package.json';
  const pkg = JSON.parse(fs.readFileSync(path));
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

node -e "
  const fs = require('fs');
  const path = 'src-tauri/tauri.conf.json';
  const conf = JSON.parse(fs.readFileSync(path));
  conf.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(conf, null, 2) + '\n');
"

sed -i '' "0,/^version = /s/^version = .*/version = \"$VERSION\"/" src-tauri/Cargo.toml

cargo check -p tauri-app >/dev/null

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo "Pushed tag v$VERSION. GitHub Actions will build and publish the release:"
echo "https://github.com/ker0s3ner/holdshort/actions"
