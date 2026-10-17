use atc_core::clearance::{Clearance, ClearanceCommand};
use atc_core::model::AirportData;
use atc_core::{airports, AircraftState, ControllerRole, Simulation};
use std::path::Path;

#[test]
fn full_departure_cycle_on_real_kbur_layout() {
    let airport = airports::load(Path::new("."), "KBUR").expect("bundled starter airport loads");
    assert_eq!(airport.runways.len(), 2);
    assert!(airport.parking_positions.len() > 10);

    let mut sim = Simulation::new(airport);

    let gate = sim.airport.parking_positions[0].ref_.clone();
    sim.spawn_departure("TEST1", "A320", &gate, "15/33", "15")
        .expect("departure spawns with a valid taxi route");

    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::AtGate);
    assert!(sim.aircraft["TEST1"].route.len() > 1);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST1".into(),
            clearance: Clearance::EngineStartApproved,
        },
        ControllerRole::Ramp,
    )
    .unwrap();
    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST1".into(),
            clearance: Clearance::PushbackApproved,
        },
        ControllerRole::Ramp,
    )
    .unwrap();
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::PushingBack);

    // Let pushback actually finish - ground can't clear a taxi for an
    // aircraft that's still ramp's (mid-pushback).
    let mut ticks = 0;
    while sim.aircraft["TEST1"].state != AircraftState::ReadyForTaxi && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::ReadyForTaxi);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST1".into(),
            clearance: Clearance::TaxiToRunway {
                via_hold_short: None,
            },
        },
        ControllerRole::Ground,
    )
    .unwrap();

    // Run the clock forward until the aircraft reaches the runway hold line.
    let mut ticks = 0;
    while sim.aircraft["TEST1"].state != AircraftState::HoldingShort && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::HoldingShort);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST1".into(),
            clearance: Clearance::LineUpAndWait,
        },
        ControllerRole::Tower,
    )
    .unwrap();
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::LinedUp);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST1".into(),
            clearance: Clearance::ClearedForTakeoff,
        },
        ControllerRole::Tower,
    )
    .unwrap();
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::TakeoffRoll);

    let mut ticks = 0;
    while sim.aircraft.contains_key("TEST1") && ticks < 1000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert!(
        !sim.aircraft.contains_key("TEST1"),
        "aircraft should depart the surface simulation after takeoff"
    );
}

/// Every airport data file in the repo should stay gate-to-runway routable,
/// independent of the network-based install flow - this reads the data/
/// directory directly rather than going through `airports::install_airport`.
#[test]
fn every_data_file_is_routable() {
    let data_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("data");
    let mut checked = 0;
    for entry in std::fs::read_dir(&data_dir).expect("data dir exists") {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if path.file_stem().and_then(|s| s.to_str()) == Some("catalog") {
            continue;
        }
        let contents = std::fs::read_to_string(&path).unwrap();
        let airport = AirportData::from_json_str(&contents)
            .unwrap_or_else(|e| panic!("{}: failed to parse: {e}", path.display()));

        assert!(!airport.runways.is_empty(), "{}: no runways", airport.icao);
        assert!(
            !airport.parking_positions.is_empty(),
            "{}: no parking positions",
            airport.icao
        );

        let runway = &airport.runways[0];
        let departure_end = runway.ends[0].clone();
        let rwy_ref = runway.ref_.clone();
        let gate = airport.parking_positions[0].ref_.clone();
        let icao = airport.icao.clone();

        let mut sim = Simulation::new(airport);
        sim.spawn_departure("ROUTETEST", "A320", &gate, &rwy_ref, &departure_end)
            .unwrap_or_else(|e| panic!("{icao}: no route from {gate} to {rwy_ref}: {e}"));
        assert!(sim.aircraft["ROUTETEST"].route.len() > 1, "{icao}");
        checked += 1;
    }
    assert!(checked > 0, "no airport data files were found to check");
}

#[test]
fn arrival_taxis_from_runway_to_gate() {
    let airport = airports::load(Path::new("."), "KBUR").unwrap();
    let gate = airport.parking_positions[3].ref_.clone();
    let mut sim = Simulation::new(airport);

    sim.spawn_arrival("TEST2", "B738", "15/33", "33", &gate)
        .expect("arrival spawns with a valid taxi route");
    assert_eq!(sim.aircraft["TEST2"].state, AircraftState::OnApproach);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST2".into(),
            clearance: Clearance::ClearedApproach,
        },
        ControllerRole::Approach,
    )
    .unwrap();

    // Flies the approach, lands, and vacates the runway - then, once clear,
    // the arrival stops and waits; ground has to actually clear it to the
    // gate, it doesn't roll straight through.
    let mut ticks = 0;
    while sim.aircraft["TEST2"].state != AircraftState::ReadyForTaxi && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST2"].state, AircraftState::ReadyForTaxi);

    sim.apply_clearance(
        ClearanceCommand {
            callsign: "TEST2".into(),
            clearance: Clearance::TaxiToGate { gate_ref: gate },
        },
        ControllerRole::Ground,
    )
    .unwrap();

    let mut ticks = 0;
    while sim.aircraft["TEST2"].state != AircraftState::Parked && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST2"].state, AircraftState::Parked);
}
