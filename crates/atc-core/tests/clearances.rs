//! Regression tests for the clearance behaviors the full-app audit flagged
//! as wired-but-inert: HoldPosition (§2.1), ClearedToLand (§2.2), and
//! ResumeTaxi's immediate re-block (§2.3).

use atc_core::clearance::{Clearance, ClearanceCommand};
use atc_core::model::AirportData;
use atc_core::{airports, AircraftState, ControllerRole, Simulation};
use std::path::Path;

fn load_sim() -> Simulation {
    let airport: AirportData = airports::load(Path::new("."), "KBUR").expect("bundled KBUR loads");
    Simulation::new(airport)
}

fn issue(sim: &mut Simulation, callsign: &str, clearance: Clearance, role: ControllerRole) {
    sim.apply_clearance(
        ClearanceCommand {
            callsign: callsign.into(),
            clearance,
        },
        role,
    )
    .unwrap();
}

/// Taxi a fresh departure out of the gate until it's moving on the taxiway
/// (state TaxiingToRunway), the state in which a mid-taxi "hold position"
/// matters.
fn spawn_taxiing_departure(sim: &mut Simulation, cs: &str) {
    let gate = sim.airport.parking_positions[0].ref_.clone();
    sim.spawn_departure(cs, "A320", &gate, "15/33", "15")
        .expect("departure spawns");
    issue(sim, cs, Clearance::EngineStartApproved, ControllerRole::Ramp);
    issue(sim, cs, Clearance::PushbackApproved, ControllerRole::Ramp);
    let mut ticks = 0;
    while sim.aircraft[cs].state != AircraftState::ReadyForTaxi && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    issue(
        sim,
        cs,
        Clearance::TaxiToRunway { via_hold_short: None },
        ControllerRole::Ground,
    );
    // A couple of ticks so it's genuinely rolling mid-taxiway, not still at
    // the gate node.
    sim.tick(1.0);
    sim.tick(1.0);
    assert_eq!(sim.aircraft[cs].state, AircraftState::TaxiingToRunway);
}

/// §2.1 - "Hold position" stops a taxiing aircraft and it STAYS stopped
/// across subsequent ticks, instead of the next tick overwriting the speed
/// from its state. "Resume taxi" then gets it moving again.
#[test]
fn hold_position_holds_a_taxiing_aircraft() {
    let mut sim = load_sim();
    spawn_taxiing_departure(&mut sim, "HOLD1");

    issue(&mut sim, "HOLD1", Clearance::HoldPosition, ControllerRole::Ground);
    let (hx, hy) = (sim.aircraft["HOLD1"].x, sim.aircraft["HOLD1"].y);

    for _ in 0..30 {
        sim.tick(1.0);
    }
    let ac = &sim.aircraft["HOLD1"];
    assert_eq!(ac.ground_speed_kt, 0.0, "held aircraft must not move");
    assert_eq!(ac.x, hx, "held aircraft must not drift in x");
    assert_eq!(ac.y, hy, "held aircraft must not drift in y");
    assert!(ac.held, "held flag stays set until resumed");

    issue(&mut sim, "HOLD1", Clearance::ResumeTaxi, ControllerRole::Ground);
    sim.tick(1.0);
    sim.tick(1.0);
    let ac = &sim.aircraft["HOLD1"];
    assert!(!ac.held, "resume taxi lifts the hold");
    assert!(
        (ac.x - hx).abs() > 0.1 || (ac.y - hy).abs() > 0.1,
        "aircraft moves again after resume"
    );
}

/// §2.1 - the same hold must work mid-pushback (the Ramp seat's hold), not
/// just mid-taxi.
#[test]
fn hold_position_holds_during_pushback() {
    let mut sim = load_sim();
    let gate = sim.airport.parking_positions[0].ref_.clone();
    sim.spawn_departure("HOLD2", "A320", &gate, "15/33", "15")
        .expect("departure spawns");
    issue(&mut sim, "HOLD2", Clearance::EngineStartApproved, ControllerRole::Ramp);
    issue(&mut sim, "HOLD2", Clearance::PushbackApproved, ControllerRole::Ramp);
    assert_eq!(sim.aircraft["HOLD2"].state, AircraftState::PushingBack);

    // Hold straight away, before pushback has a chance to complete.
    issue(&mut sim, "HOLD2", Clearance::HoldPosition, ControllerRole::Ramp);
    let (hx, hy) = (sim.aircraft["HOLD2"].x, sim.aircraft["HOLD2"].y);
    for _ in 0..30 {
        sim.tick(1.0);
    }
    let ac = &sim.aircraft["HOLD2"];
    assert_eq!(ac.state, AircraftState::PushingBack, "still pushing back, held");
    assert_eq!(ac.ground_speed_kt, 0.0);
    assert_eq!(ac.x, hx);
    assert_eq!(ac.y, hy);

    issue(&mut sim, "HOLD2", Clearance::ResumeTaxi, ControllerRole::Ramp);
    let mut ticks = 0;
    while sim.aircraft["HOLD2"].state == AircraftState::PushingBack && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(
        sim.aircraft["HOLD2"].state,
        AircraftState::ReadyForTaxi,
        "pushback completes once the hold is lifted"
    );
}

/// §2.2 - an arrival on final does NOT land until Tower clears it to land,
/// even once it's been cleared for the approach. The landing is gated on
/// cleared_to_land, not cleared_approach, and arrivals no longer spawn
/// pre-cleared.
#[test]
fn cleared_to_land_gates_the_landing() {
    let mut sim = load_sim();
    let gate = sim.airport.parking_positions[3].ref_.clone();
    sim.spawn_arrival("LAND1", "B738", "15/33", "33", &gate)
        .expect("arrival spawns");
    assert_eq!(sim.aircraft["LAND1"].state, AircraftState::OnApproach);
    assert!(
        !sim.aircraft["LAND1"].cleared_to_land,
        "arrival must not spawn already cleared to land"
    );

    // Cleared for the approach, but not to land - and no automation, so no
    // AI tower steps in.
    issue(&mut sim, "LAND1", Clearance::ClearedApproach, ControllerRole::Approach);
    for _ in 0..600 {
        sim.tick(1.0);
    }
    assert_eq!(
        sim.aircraft["LAND1"].state,
        AircraftState::OnApproach,
        "without a landing clearance it holds on final, it does not land itself"
    );

    // Tower clears it to land while it's still on final (the cross-position
    // clearance) and it lands.
    issue(&mut sim, "LAND1", Clearance::ClearedToLand, ControllerRole::Tower);
    let mut ticks = 0;
    while matches!(sim.aircraft["LAND1"].state, AircraftState::OnApproach) && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert!(
        matches!(
            sim.aircraft["LAND1"].state,
            AircraftState::LandingRollout | AircraftState::ReadyForTaxi
        ),
        "lands once cleared to land"
    );
}

/// §2.2 - a session that isn't working Tower still lands its arrivals: the
/// AI tower clears an established arrival to land.
#[test]
fn ai_tower_clears_arrival_to_land_when_tower_unworked() {
    let mut sim = load_sim();
    let gate = sim.airport.parking_positions[3].ref_.clone();
    sim.spawn_arrival("LAND2", "B738", "15/33", "33", &gate)
        .expect("arrival spawns");

    // Working Ground: neither Approach nor Tower is the human, so both the
    // approach clearance and the landing clearance come from automation.
    let mut ticks = 0;
    while sim.aircraft["LAND2"].state == AircraftState::OnApproach && ticks < 100_000 {
        sim.apply_automation(ControllerRole::Ground);
        sim.tick(1.0);
        ticks += 1;
    }
    assert_ne!(
        sim.aircraft["LAND2"].state,
        AircraftState::OnApproach,
        "AI approach + AI tower get the arrival onto the runway"
    );
}

/// §2.3 - "resume taxi" from a hold-short clears the restriction so the
/// aircraft proceeds past the hold node instead of immediately dropping
/// back to HoldingShort on the next tick.
#[test]
fn resume_taxi_clears_hold_short_and_proceeds() {
    let mut sim = load_sim();
    let gate = sim.airport.parking_positions[0].ref_.clone();
    sim.spawn_departure("RES1", "A320", &gate, "15/33", "15")
        .expect("departure spawns");
    issue(&mut sim, "RES1", Clearance::EngineStartApproved, ControllerRole::Ramp);
    issue(&mut sim, "RES1", Clearance::PushbackApproved, ControllerRole::Ramp);
    let mut ticks = 0;
    while sim.aircraft["RES1"].state != AircraftState::ReadyForTaxi && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }

    // Hold short of a node partway along the route, so the aircraft stops
    // mid-taxi rather than at the runway end.
    let route = sim.aircraft["RES1"].route.clone();
    let mid_index = route.len() / 2;
    let hold_node = route[mid_index].clone();
    issue(
        &mut sim,
        "RES1",
        Clearance::TaxiToRunway {
            via_hold_short: Some(hold_node.clone()),
        },
        ControllerRole::Ground,
    );

    let mut ticks = 0;
    while sim.aircraft["RES1"].state != AircraftState::HoldingShort && ticks < 100_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert_eq!(sim.aircraft["RES1"].state, AircraftState::HoldingShort);
    assert_eq!(
        sim.aircraft["RES1"].hold_short_node.as_deref(),
        Some(hold_node.as_str())
    );
    let index_at_hold = sim.aircraft["RES1"].route_index;

    // HoldingShort is Tower's phase, so the resume comes from Tower.
    issue(&mut sim, "RES1", Clearance::ResumeTaxi, ControllerRole::Tower);
    assert_eq!(sim.aircraft["RES1"].state, AircraftState::TaxiingToRunway);
    assert!(
        sim.aircraft["RES1"].hold_short_node.is_none(),
        "resume drops the hold-short node"
    );

    // The very next tick must not re-block it at the same node.
    sim.tick(1.0);
    assert_ne!(
        sim.aircraft["RES1"].state,
        AircraftState::HoldingShort,
        "it does not immediately re-block at the former hold-short node"
    );
    // And it keeps advancing past that node.
    let mut ticks = 0;
    while sim.aircraft["RES1"].route_index <= index_at_hold && ticks < 1_000 {
        sim.tick(1.0);
        ticks += 1;
    }
    assert!(
        sim.aircraft["RES1"].route_index > index_at_hold,
        "aircraft advances past the former hold-short node"
    );
}
