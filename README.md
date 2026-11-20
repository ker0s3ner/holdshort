# Holdshort

A ground-operations and terminal-airspace ATC simulator built with Tauri (Rust core + React/Canvas frontend). macOS (Apple Silicon) first; Windows later.

Holdshort uses real-world taxiway, runway and gate geometry from OpenStreetMap, A* taxi routing, a ramp/ground/tower clearance state machine, Approach vectoring (heading, altitude, speed) and procedural AI traffic. Arrivals are flown in from a spawn point onto final rather than teleported onto the runway.

Every position the human controller is not working runs on its own AI timer (pushback, taxi, takeoff, approach clearance), so a single-position session still produces a complete, moving traffic flow.

## Features

- **Positions.** Ramp, Ground, Tower and Approach. On launch you pick an airport and a position.
- **Three views.** A Surface Movement Radar (SMR) plan display, a Tower Cab view over Esri satellite imagery with a visibility ring, and an Approach radar scope with range rings and datablocks.
- **Scope tooling.** A scope command line, DCB, datablocks, handoff tracking, point-outs and controller messaging.
- **Voice.** Speech-to-text on the mic (whisper.cpp through the Rust backend), a clearance/intent parser, spoken pilot readbacks and ATIS.
- **Training.** Selectable scenarios, deterministic seeded traffic, runway/taxiway/airborne safety monitoring, pause/resume, replay checkpoints, explainable scoring and exportable debrief reports. Instructor Lab permits unsafe clearances to demonstrate consequences; normal scenarios enforce runway occupancy rules.
- **Plugins.** A read-only plugin SDK: plugins run in a sandboxed `<iframe>` and receive a live feed of traffic, airport and theme data over `postMessage` (see `src/pluginProtocol.ts`). They cannot issue clearances.
- **Auto-update.** Installed copies check for signed updates on launch.

## Airports

Only KBUR ships inside the app. Every other airport is downloaded on demand from the catalog at `crates/atc-core/data/catalog.json` (48 airports, mostly the UK, Ireland and Northern Europe/Baltics plus six US fields, Frankfurt, Istanbul, Dubai and Tokyo, including EGLL, EGKK, KJFK, KATL, KLAX, KORD, KDFW, EDDF, LTFM, OMDB and RJTT). The app fetches the catalog and per-airport files from this repository over GitHub's raw content CDN, so pushing a new airport JSON plus a catalog entry makes it installable without an app release.

To add one, run the converter with the airport's ICAO code, then add it to `catalog.json`:

```bash
python3 tools/convert_airport.py <ICAO>
```

It pulls surface geometry from the OpenStreetMap Overpass API and converts it to the engine's graph format.

## Project layout

```
crates/atc-core/   simulation engine, no Tauri dependency
  src/             graph, pathfinding, aircraft, clearance state machine,
                   scenarios, traffic generator, training/scoring
  data/            airport JSON files and catalog.json
  tests/           clearance and smoke tests
src-tauri/         Tauri shell: commands, sim tick loop, STT, auto-updater
src/               React/TypeScript frontend
  components/      SurfaceDisplay, TowerCabView, ApproachView, ClearancePanel,
                   TrainingPanel, PluginHost, setup and settings dialogs
tools/             convert_airport.py and Node unit tests for the parsers
scripts/           release.sh, resign-local.sh, serve_docs.py, coverage data
docs/              published coverage page (GitHub Pages)
plans/             planning notes
```

## Development

Requires Node.js, a Rust toolchain and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev       # run the app
npm run build           # type-check and build the frontend
cargo test -p atc-core  # engine tests
```

The TypeScript parser and scope tests in `tools/*_test.cjs` are plain Node scripts, e.g. `node tools/intent_parser_test.cjs`.

## Releasing

Releases are built and published by GitHub Actions (`.github/workflows/release.yml`) whenever a `vX.Y.Z` tag is pushed. Each release gets a signed, notarizable DMG plus `latest.json`; installed copies read that endpoint on launch and update themselves.

```bash
scripts/release.sh 0.34.0
```

This bumps the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, commits, tags and pushes. Watch the build at https://github.com/ker0s3ner/holdshort/actions. The current app version is in `package.json`.

`.github/workflows/pages.yml` publishes `docs/`.

### Update signing key

Update packages are signed with a minisign keypair generated locally (`.tauri/holdshort.key`, gitignored, **do not commit it**). The public key lives in `src-tauri/tauri.conf.json`. The private key and its password are the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets on the GitHub repo, used only by the release workflow. If the key is lost, generate a new one and update the public key in `tauri.conf.json`; existing installs cannot verify updates signed with a different key and need a one-time manual reinstall.

## Attribution

Airport surface data is derived from OpenStreetMap contributors (ODbL), see the in-app attribution line. Tower Cab satellite imagery is served by Esri World Imagery (Esri, Maxar, Earthstar Geographics).
