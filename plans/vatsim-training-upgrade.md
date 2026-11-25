# VATSIM-oriented training upgrade

## Primary goal

Turn Holdshort from a procedural ATC sandbox into a useful self-training product: it should create repeatable controller scenarios, detect unsafe or incorrect outcomes, record what happened, and explain performance afterward.

## Phase 0 — Documentation discovery

**How this serves the primary goal:** This anchors the implementation in the existing simulation, event, UI, and test patterns so new training features are integrated rather than parallel systems.

Read the current README, roadmap, Rust simulation/traffic modules, Tauri event loop, TypeScript types, React session shell, clearance parser, command tests, and Rust integration tests. Record the actual data flow and the existing APIs before changing them.

Allowed existing patterns: `Simulation::tick`, `Simulation::apply_clearance`, `Simulation::apply_automation`, `SimEvent`, `SimTick`, Tauri `emit`, React `listen`, `invoke`, `AircraftSnapshot`, and the existing test harnesses in `crates/atc-core/tests` and `tools/`.

Verification: compile the current project and run all existing Rust and TypeScript test scripts before implementation.

Anti-pattern guards: do not make the frontend the source of truth for safety; do not invent a second aircraft model; do not treat a visual alert as equivalent to backend enforcement.

## Phase 1 — Safety and operational consequence engine

**How this serves the primary goal:** A trainee must be able to make a bad decision and receive a deterministic, explainable consequence.

Add backend safety events and a per-session incident log for runway conflicts, runway incursions, taxiway proximity conflicts, airborne separation loss, late/incorrect clearances, and missed required readbacks. Enforce runway occupancy and basic wake/separation rules when issuing takeoff and landing clearances, while preserving an instructor mode that can deliberately allow unsafe clearances for evaluation. Surface safety events through the existing Tauri event stream and snapshot.

Verification: unit-test each detector with controlled aircraft fixtures; test that normal traffic produces no false alarms; test that unsafe clearances are rejected or recorded according to mode.

Anti-pattern guards: use the simulation clock, not wall time; use horizontal/vertical separation thresholds with named constants; keep detection pure and testable.

## Phase 2 — Scenario and traffic authoring

**How this serves the primary goal:** Repeatable exercises are necessary to practice a specific weakness instead of hoping random traffic creates it.

Add scenario definitions with role, airport, runway configuration, initial traffic, spawn schedule, objectives, injected events, and difficulty. Add deterministic seeded traffic generation, arrival sequencing/spacing, wake categories, richer flight-plan fields, and scenario start/restart controls.

Verification: load a built-in scenario, reproduce the same traffic with the same seed, assert objective completion/failure, and verify arrivals respect configured spacing.

Anti-pattern guards: keep scenario data serializable and versioned; preserve free-play mode; do not hard-code scenario behavior into React components.

## Phase 3 — Training feedback, grading, and replay

**How this serves the primary goal:** The user needs to know not only that something went wrong, but what skill to improve and whether performance is getting better.

Record controller actions, aircraft state checkpoints, radio transmissions, incidents, objective progress, workload metrics, and timing. Implement a rubric with safety, efficiency, phraseology, coordination, and objective scores. Add pause/restart, replay timeline, session summary, and export/import of a training report.

Verification: replay a recorded session deterministically; verify score components against fixtures; verify reports survive serialization; test that incomplete sessions are clearly marked.

Anti-pattern guards: never infer a passing score from “no crash”; keep raw events alongside derived scores; make scoring explainable.

## Phase 4 — Training UI and voice/readback evaluation

**How this serves the primary goal:** The safety model and score only help if the trainee can see, understand, and act on them while controlling.

Add a training-mode launcher, scenario picker, objective/incident panel, live safety banner, score indicator, pause/restart controls, and post-session debrief. Capture controller transmissions and compare readbacks/clearances against the issued clearance, while keeping the existing voice fallback behavior.

Verification: exercise the complete flow from scenario selection to debrief; verify alerts are readable without obscuring the scope; verify keyboard and voice paths produce the same scored action.

Anti-pattern guards: do not make the alert panel the only place an aircraft remains visible; do not block the simulation on local LLM availability; distinguish parser uncertainty from trainee error.

## Phase 5 — Verification

**How this serves the primary goal:** A training tool must be trustworthy enough that users can rely on its feedback.

Run Rust tests, TypeScript tests, production build, scenario determinism checks, replay round trips, and a manual smoke session for each controller position. Review the final diff for unsafe-clearance bypasses, unbounded event growth, nondeterministic scoring, and missing UI error handling.

Anti-pattern guards: no destructive repository operations; no claims of VATSIM equivalence; document remaining realism limits.
