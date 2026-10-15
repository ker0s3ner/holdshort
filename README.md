# Ground Control

A ground-operations ATC simulator: real-world taxiway/runway/gate geometry
(pulled from OpenStreetMap), A* taxi routing, a ground/tower clearance state
machine, procedural AI traffic, and a Surface Movement Radar (SMR) plan-view
display. Built with Tauri (Rust core + React/Canvas frontend). macOS
(Apple Silicon) first; Windows later.

## Project layout

- `crates/atc-core` — the simulation engine, no Tauri dependency. Airport
  graph, pathfinding, aircraft/clearance state machine, traffic generator.
- `src-tauri` — the Tauri shell: commands, the sim tick loop, auto-updater.
- `src` — the React/TypeScript frontend (SMR canvas display, clearance panel).
- `tools/convert_airport.py` — pulls an airport's real surface geometry from
  OpenStreetMap (Overpass API) and converts it into the engine's graph format.
  Run it again with a different ICAO to add another airport.

## Development

```bash
npm install
npm run tauri dev
```

## Releasing

Releases are built and published by GitHub Actions
(`.github/workflows/release.yml`) whenever a `vX.Y.Z` tag is pushed. Each
release gets a signed, notarizable DMG plus `latest.json`; installed copies
of the app check that endpoint on launch and update themselves — no manual
DMG re-download needed after the first install.

To cut a release:

```bash
scripts/release.sh 0.2.0
```

This bumps the version in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`, commits, tags, and pushes. Watch the build at
https://github.com/ker0s3ner/ground-control/actions.

### Update signing key

Update packages are signed with a minisign keypair generated locally
(`.tauri/groundcontrol.key`, gitignored — **do not commit it**). The public
key lives in `src-tauri/tauri.conf.json`. The private key and its password
are stored as the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets on the GitHub repo, used only by
the release workflow. If `.tauri/groundcontrol.key` is ever lost, a new
keypair must be generated and the public key in `tauri.conf.json` updated —
existing installs won't be able to verify updates signed with a different
key, so they'd need a manual reinstall once.

## Attribution

Airport surface data is derived from OpenStreetMap contributors (ODbL) —
see the in-app attribution line.
