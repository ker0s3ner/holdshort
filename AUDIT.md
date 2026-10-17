# Holdshort — Full App Audit

_Read-only audit (roadmap item #7), 2026-10-17. No app behavior was changed; the only file written is this report._

## Verified build state

All green on this branch, confirmed by building and running every check:

| Check | Result |
|---|---|
| `npm run build` (tsc + vite) | ✅ built, 336 KB JS (gzip 103 KB) |
| `npx tsc --noEmit` | ✅ clean |
| `node tools/scope_commands_test.cjs` | ✅ 104/104 |
| `cargo test --workspace` | ✅ 3/3 smoke (`full_departure_cycle`, `arrival_taxis_from_runway_to_gate`, `every_data_file_is_routable`) |

The app is in genuinely good shape: no failing tests, no TS errors, no stray TODO/FIXME markers in source. The findings below are about *behavioral* bugs and unfinished data paths, not build breakage.

---

## 1. WORKS — implemented and functional end to end

### Rust simulation core (`crates/atc-core`)
- **Full departure life-cycle**: `AtGate → PushingBack → ReadyForTaxi → TaxiingToRunway → HoldingShort → LinedUp → TakeoffRoll → Departed → despawn`, each transition driven by `sim.rs::tick`/`apply_clearance`. Covered by `tests/smoke.rs:7`.
- **Full arrival life-cycle**: spawns on an ~18 nm final (`sim.rs:32`, `spawn_arrival` `sim.rs:174`), flies a default 3° glideslope, lands only when cleared, decelerates, stops at the mapped runway exit (`runway_exit_index`), waits for a taxi clearance, taxis to gate, parks, and despawns after `GATE_DWELL_S`. Covered by `tests/smoke.rs:141`.
- **Phase-based ownership** (`aircraft.rs::owning_role` `aircraft.rs:45`): each state maps to the responsible position, and `apply_clearance` refuses a clearance from the wrong seat (`sim.rs:301`). This is the spine the whole handoff/datablock model hangs off.
- **AI automation of unworked positions** (`sim.rs::apply_automation` `sim.rs:588`): ramp pushes, ground taxis, tower launches (with a runway-occupancy guard `sim.rs:653`), approach clears — all on plausible timers so a single-seat session keeps moving.
- **Approach control**: `Vector`, `ClimbAndMaintain`/`DescendAndMaintain`, `AssignSpeed` all take effect on `OnApproach` and `Departed` traffic with standard-rate turns and eased alt/speed (`sim.rs:384`, `:482`, `:506`).
- **Multi-runway config** (`traffic.rs::RunwayUse` `traffic.rs:11`, `lib.rs::set_runway_use` `lib.rs:144`): several runway ends active at once, each dep/arr-toggled, with per-end occupancy guarding spawns (`traffic.rs:146`).
- **A\* taxi routing** (`graph.rs::find_path`) plus a dedicated arrival router that refuses to double back along the runway (`graph.rs::find_arrival_path` `graph.rs:131`).
- **Region-aware traffic generation** (`traffic.rs::region_pools` `traffic.rs:87`): airline/destination pools keyed off the field's ICAO prefix, narrow/widebody mix, wake category in the callsign.
- **Airport data pipeline** (`airports.rs`): bundled KBUR starter + GitHub-CDN catalog/install/uninstall with a parse-sanity check before caching (`airports.rs:107`).

### Tauri shell (`src-tauri/src/lib.rs`)
- 4 Hz physics / 1 Hz display snapshot loop with event emission (`lib.rs:738`), `sim-event` for unprompted pilot calls emitted immediately.
- Commands for session lifecycle, clearances, METAR fetch (`get_metar` `lib.rs:196`), Ollama text gen + model pull with streaming progress, whisper.cpp model download + transcription, mic-permission reset, Launch Services refresh. All real, all wired.

### Frontend (`src/`)
- **Three canvas scopes** sharing one display layer: `SurfaceDisplay` (SMR/ASDE-X), `TowerCabView` (2D plan over live Esri satellite tiles), `ApproachView` (range-ring radar with rotation/range). All read `getScopeSettings()` live each frame.
- **Shared scope architecture** (`scopeDisplay.ts`): persisted settings store, LDB/PDB/FDB datablock fidelity from ownership (`fidelityOf` `scopeDisplay.ts:293`), per-track leader lines, Quick Look, 32-slot pref sets (SAVE/LOAD/DEL/LIST).
- **Scope command line** (`scopeCommands.ts`) — HDG/ALT/FL/SPD/CA/PT/MSG/QL/DB/RINGS/LEN/DIR/R/ROT/VIS/PS, callsign-lead or slew — exercised by the 104-check harness.
- **Coordination**: point-outs with pending/accepted/rejected animation (`pointOuts.ts`), handoff diff + 5 s flash (`handoffTracking.ts`), two-way controller messaging with deterministic AI replies and rate-limited inbound (`controllerMessaging.ts`).
- **Voice stack**: Web-Audio 16 kHz PCM capture (`stt.ts`), whisper.cpp transcription with an ATC initial-prompt bias and a hallucination filter (`lib.rs:614`, `:655`), Ollama-generated readbacks with a 4 s timeout fallback to templates (`voice.ts:51`), TTS with callsign spelling.
- **ATIS** from live METAR parsing (`atis.ts`), airport management UI, in-app auto-updater banner, first-run setup wizard, sandboxed read-only plugin host (`PluginHost.tsx`, `pluginProtocol.ts`), profiles with import/export.

---

## 2. BROKEN / BUGGY — wired but misbehaving

Ranked by user-facing impact.

### 2.1 `HoldPosition` is a no-op  — _High: a visible control that silently does nothing_
`apply_clearance` sets `ground_speed_kt = 0.0` (`sim.rs:352`), but the very next `tick` unconditionally overwrites ground speed from the aircraft's state — e.g. `TaxiingToRunway`/`TaxiingToGate` reset it to `TAXI_SPEED_KT` (`sim.rs:433`), pushback to `PUSHBACK_SPEED_KT`. The state is never changed, so the aircraft keeps moving. The clearance is exposed as a button on both Ramp and Ground (`ClearancePanel.tsx:31`, `:37`) and via voice "hold"/"hold position" (`clearanceParser.ts:51`), all inert.

### 2.2 "Cleared to Land" does nothing — _High: Tower's headline clearance is inert_
The landing transition is gated on `cleared_approach` (`sim.rs:529`), not `cleared_to_land`. `Clearance::ClearedToLand` only sets `ac.cleared_to_land = true` (`sim.rs:372`), a field that is written (`:157`, `:242`, `:381`) but **never read** anywhere in the tick. So the Tower "Cleared to Land" button (`ClearancePanel.tsx:43`) and voice "cleared to land" (`clearanceParser.ts:26`) have no effect; an arrival actually lands off `ClearedApproach` (an Approach clearance) or the AI auto-clear. Arrivals also spawn with `cleared_to_land = true` already. Net effect: the Tower seat's main arrival action is cosmetic.

### 2.3 `ResumeTaxi` can immediately re-block — _Medium_
`ResumeTaxi` flips `HoldingShort → TaxiingToRunway` (`sim.rs:355`) but leaves `hold_short_node` set. If that node is still the aircraft's current target, the next tick's hold-short check (`sim.rs:434`) drops it straight back to `HoldingShort`. It only works once the hold node is behind the aircraft. (It also does nothing after a `HoldPosition`, since that never set `HoldingShort` — see 2.1.)

### 2.4 `CancelClearance` clears flags but not motion — _Low_
Resets `cleared_for_takeoff`/`cleared_to_land`/`cleared_pushback` (`sim.rs:379`) without reverting state, so a cancel during `TakeoffRoll` leaves the aircraft rolling. Arguably acceptable, but it's a partial implementation of "cancel."

---

## 3. HALF-BUILT / STUBBED / DEAD CODE

- **`towers` data path is dead.** `model::Tower` (`model.rs:62`) and `AirportData.towers` (`model.rs:82`) are parsed, serialized, and typed on the frontend (`types.ts:55`, `:71`), and documented as anchoring "the Tower Cab **3D view's** camera" (`model.rs:59`). But `TowerCabView` is a **2D plan over satellite imagery** (`TowerCabView.tsx:149`) and never reads `airport.towers` — grep finds only the type declaration. The field is populated-but-unconsumed and the 3D-camera comment is stale.
- **`get_traffic` command is unused.** Registered in the invoke handler (`lib.rs:177`, `:792`) but the frontend only ever consumes `sim-tick`/`sim-event` events — no `invoke("get_traffic")` exists. Dead command.
- **`graph.rs::nearest_node` (`graph.rs:166`) is never called.** Dead.
- **`find_path` doc references a nonexistent `avoid_kind` param** (`graph.rs:71`) "reserved for future runway-crossing clearance logic." Runway-crossing clearances aren't modeled, so this is a stale doc for an unbuilt feature.
- **Two parallel command parsers.** `scopeCommands.runCommand` (full, tested) coexists with `clearanceParser.parseCommand` (a H/D/C/S/CA/GA subset) used only in the ClearancePanel Approach box (`ClearancePanel.tsx:92`). Redundant surfaces for the same job.
- **Voice can't taxi an arrival in.** `parseClearance` maps "taxi" to `TaxiToRunway` only (`clearanceParser.ts:63`); there's no `TaxiToGate` voice path, so an arrival can only be sent to a gate via the Ground gate-picker dropdown.
- **Plugin SDK is read-only by design** (`pluginProtocol.ts:7`): a write/clearance API is explicitly deferred, and only one plugin (`worldmap`) ships.

---

## 4. GAPS vs the roadmap

### (1) SAID / STARS / ERAM display systems — _greenfield; strong scaffold to build on_
There is **no** STARS/ERAM/SAID-specific display. What exists is a generic, well-factored scope layer (`scopeDisplay.ts`: DCB, LDB/PDB/FDB fidelity, leader lines, pref sets, Quick Look) that already borrows the vocabulary ("ASDE-X 32 slots", "ERAM habits" are comments, not implementations). The three concrete scopes (SMR/Tower/Approach) are all built on that shared layer, so adding a STARS- or ERAM-styled renderer is additive: a new view component + a `ScopeKind`, reusing `drawLeaderBlock`/`fidelityOf`/`ScopeDCB`. **Missing**: the actual system-specific symbology, datablock formats, maps/filters, and the data to feed them (beacon codes, scratchpads, CA/MSAW, etc. — none modeled). Readiness: **high scaffold, no system-specific content.**

### (2) Conversational controller chat — _deterministic responder in place_
`controllerMessaging.ts::composeReply` (`:236`) is an intent-matching deterministic responder (release/APREQ/point-out/handoff/verify/traffic/config), chosen deliberately for testability. It's the documented insertion point for an AI responder: swap `composeReply`/`composeHandoffCoordination` for an `ask_ai`-backed async path (the Ollama plumbing already exists in `voice.ts`). The two-way net, rate-limiting, threading, and unread badging are done. Readiness: **high — one function to replace.**

### (3) Center / en-route position — _moderate plumbing, larger simulation gap (see §5)_

### (4) Weather / weather radar — _text-weather only_
Live METAR fetch (`get_metar` `lib.rs:196`) and ATIS parsing (`atis.ts`) exist, and Tower Cab draws a visibility ring (`TowerCabView.tsx:278`). **Missing**: weather *radar* (precip returns/NEXRAD overlay), and any weather *effect on the sim* — wind doesn't influence runway selection, approach, or taxi; there's no precip, ceiling, or gust model in the core. Readiness: **data source present, zero simulation/visualization of actual weather.**

### (5) SMR + Tower Cab redesign — _solid, self-contained canvases_
Both are single-file canvas components (`SurfaceDisplay.tsx` 441 lines, `TowerCabView.tsx` 546) sharing `toScreen`/glyph/`drawLeaderBlock`/`getRadarPalette`. They're theme-aware (`radarPalette.ts`) and self-contained, so a redesign is low-risk — no shared-state entanglement to unpick. The Tower Cab's `towers` 3D data (§3) is the one latent hook already in the data model if a true out-the-window view is ever wanted. Readiness: **clean redesign target.**

### (6) Voice-input quality — _good pipeline, known weak spots_
Pipeline is complete: PCM capture → whisper.cpp with ATC prompt bias + hallucination filter → keyword `parseClearance`. Weak spots to improve: (a) `parseClearance` is regex keyword-matching, not NLU (`clearanceParser.ts`) and misses `TaxiToGate`, hold variants, and numeric edge cases; (b) ground-truth gaps feed inert clearances (§2.1/2.2) so even a *correct* transcription of "hold position"/"cleared to land" does nothing; (c) model is `small.en` by default — accuracy is model-bound. Readiness: **working, incremental quality work.**

---

## 5. Center position — difficulty of adding a 5th `ControllerRole`

`ControllerRole` is a 4-variant enum (`aircraft.rs:16`) serialized lowercase, threaded through both halves:
- **Rust**: `owning_role` (`aircraft.rs:45`), `apply_automation` arms (`sim.rs:596`), `AppState.role` (`lib.rs:21`), snapshot `owning_role` (`lib.rs:48`).
- **Frontend**: the `ControllerRole` union (`types.ts:132`), `roleLabel`/`parseRole` (`pointOuts.ts:34`, `scopeCommands.ts:45`, `controllerMessaging.ts:97`), `BUTTONS_BY_ROLE` + `ADJACENT_POSITIONS` (`ClearancePanel.tsx:27`, `:56`), `parties()` (`controllerMessaging.ts:87`), `frequencies.ts`, profile `displayType`.

**The enum plumbing is the easy part.** `owning_role`'s `match` is exhaustive over *states*, not roles, and the automation/UI role checks use `if active_role != X` guards with `_ =>` fallthroughs — so adding `ControllerRole::Center` compiles with only a handful of compiler-forced edits (the role maps in `pointOuts.ts`, `scopeCommands.ts`, `controllerMessaging.ts`, `ClearancePanel.tsx`, `frequencies.ts`). Call this **1–2 days of plumbing**.

**The simulation substance is the hard part.** Ownership is derived *purely from `AircraftState`* (`aircraft.rs:45`), and there is no en-route airspace in the model: departures climb to 10,000 ft or 90 s and **despawn** (`sim.rs:46`, `:500`), and arrivals **spawn** fully formed on an 18 nm final (`sim.rs:32`, `spawn_arrival`). There is nothing between airports for a Center to own. A real Center role needs:
1. New `AircraftState`(s) for cruise / en-route / handoff-to-Center, with `owning_role` mappings and an `apply_automation` arm.
2. A traffic life-cycle change: departures handed *up* to Center instead of despawning, and arrivals originating *from* Center before Approach takes them.
3. En-route structure the core doesn't have — airways/fixes/sectors and, realistically, a multi-airport picture (a Center spans many fields; the whole sim today is one airport's surface + terminal area).
4. A Center scope view (wide-area, larger range than Approach, probably multi-field).

**Verdict:** adding the *role* is moderate and low-risk. Adding a *meaningful Center* is a larger effort gated on new en-route simulation, not on the enum. Recommend scoping it as "en-route traffic model first, role second."

---

## Priority recommendations

1. **Fix the two inert clearances** (`HoldPosition` §2.1, `ClearedToLand` §2.2) — they're one-liners' worth of core logic and currently make visible Tower/Ground/Ramp controls lie to the user. Highest value-to-effort.
2. **Fix `ResumeTaxi` re-block** (§2.3) by clearing `hold_short_node` on resume.
3. **Decide the `towers` data path** (§3): either consume it (a real Tower Cab feature) or remove the struct/field + stale 3D comment.
4. **Remove dead code** (`get_traffic`, `nearest_node`, `find_path` stale doc) to keep the surface honest.
5. Roadmap sequencing: **conversational chat** (#2) and **SMR/Tower redesign** (#5) are the lowest-friction next tracks; **Center** (#3) and **weather radar/effects** (#4) each need new core simulation and should be planned as such.
