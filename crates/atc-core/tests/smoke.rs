use atc_core::clearance::{Clearance, ClearanceCommand};
use atc_core::{airports, AircraftState, Simulation};

#[test]
fn full_departure_cycle_on_real_kbur_layout() {
    let airport = airports::load("KBUR").expect("bundled airport data loads");
    assert_eq!(airport.runways.len(), 2);
    assert!(airport.parking_positions.len() > 10);

    let mut sim = Simulation::new(airport);

    let gate = sim.airport.parking_positions[0].ref_.clone();
    sim.spawn_departure("TEST1", "A320", &gate, "15/33", "15")
        .expect("departure spawns with a valid taxi route");

    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::AtGate);
    assert!(sim.aircraft["TEST1"].route.len() > 1);

    sim.apply_clearance(ClearanceCommand {
        callsign: "TEST1".into(),
        clearance: Clearance::PushbackApproved,
    })
    .unwrap();
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::PushingBack);

    sim.apply_clearance(ClearanceCommand {
        callsign: "TEST1".into(),
        clearance: Clearance::TaxiToRunway {
            via_hold_short: None,
        },
    })
    .unwrap();

    // Run the clock forward until the aircraft reaches the runway hold line.
    let mut ticks = 0;
    while sim.aircraft["TEST1"].state != AircraftState::HoldingShort && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::HoldingShort);

    sim.apply_clearance(ClearanceCommand {
        callsign: "TEST1".into(),
        clearance: Clearance::LineUpAndWait,
    })
    .unwrap();
    assert_eq!(sim.aircraft["TEST1"].state, AircraftState::LinedUp);

    sim.apply_clearance(ClearanceCommand {
        callsign: "TEST1".into(),
        clearance: Clearance::ClearedForTakeoff,
    })
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

#[test]
fn arrival_taxis_from_runway_to_gate() {
    let airport = airports::load("KBUR").unwrap();
    let gate = airport.parking_positions[3].ref_.clone();
    let mut sim = Simulation::new(airport);

    sim.spawn_arrival("TEST2", "B738", "15/33", "33", &gate)
        .expect("arrival spawns with a valid taxi route");
    assert_eq!(sim.aircraft["TEST2"].state, AircraftState::LandingRollout);

    let mut ticks = 0;
    while sim.aircraft["TEST2"].state != AircraftState::Parked && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["TEST2"].state, AircraftState::Parked);
}
