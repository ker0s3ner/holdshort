use crate::aircraft::{Aircraft, AircraftState, FlightPlan, FlightRule};
use crate::clearance::{Clearance, ClearanceCommand};
use crate::graph::TaxiGraph;
use crate::model::AirportData;
use serde::Serialize;
use std::collections::HashMap;

const KT_TO_MPS: f64 = 0.514444;
const TAXI_SPEED_KT: f64 = 15.0;
const PUSHBACK_SPEED_KT: f64 = 3.0;
const TAKEOFF_ROLL_ACCEL_KT_PER_S: f64 = 4.0;
const TAKEOFF_DECISION_SPEED_KT: f64 = 140.0;
const LANDING_ROLLOUT_SPEED_KT: f64 = 60.0;
const LANDING_DECEL_KT_PER_S: f64 = 3.0;
const LANDING_EXIT_SPEED_KT: f64 = 15.0;

#[derive(Debug, Clone, Serialize)]
pub struct SimEvent {
    pub callsign: String,
    pub message: String,
}

pub struct Simulation {
    pub airport: AirportData,
    pub graph: TaxiGraph,
    pub aircraft: HashMap<String, Aircraft>,
    pub clock_s: f64,
}

impl Simulation {
    pub fn new(airport: AirportData) -> Self {
        let graph = TaxiGraph::build(&airport);
        Simulation {
            airport,
            graph,
            aircraft: HashMap::new(),
            clock_s: 0.0,
        }
    }

    pub fn gate_node(&self, gate_ref: &str) -> Option<String> {
        self.airport
            .parking_positions
            .iter()
            .find(|p| p.ref_ == gate_ref)
            .map(|p| p.node.clone())
    }

    pub fn runway_threshold_node(&self, runway_ref: &str, end: &str) -> Option<String> {
        let rw = self
            .airport
            .runways
            .iter()
            .find(|r| r.ref_ == runway_ref)?;
        if rw.ends.first().map(|s| s.as_str()) == Some(end) {
            Some(rw.node_start.clone())
        } else {
            Some(rw.node_end.clone())
        }
    }

    pub fn spawn_departure(
        &mut self,
        callsign: &str,
        aircraft_type: &str,
        gate_ref: &str,
        runway_ref: &str,
        departure_end: &str,
    ) -> Result<(), String> {
        let gate_node = self
            .gate_node(gate_ref)
            .ok_or_else(|| format!("unknown gate {gate_ref}"))?;
        let runway_node = self
            .runway_threshold_node(runway_ref, departure_end)
            .ok_or_else(|| format!("unknown runway {runway_ref}"))?;

        let route = self
            .graph
            .find_path(&gate_node, &runway_node)
            .ok_or_else(|| format!("no taxi route from gate {gate_ref} to runway {runway_ref}"))?;

        let start = &self.graph.nodes[&gate_node];
        let aircraft = Aircraft {
            callsign: callsign.to_string(),
            aircraft_type: aircraft_type.to_string(),
            state: AircraftState::AtGate,
            flight_plan: FlightPlan {
                callsign: callsign.to_string(),
                aircraft_type: aircraft_type.to_string(),
                rule: FlightRule::Departure,
                origin: self.airport.icao.clone(),
                destination: "----".to_string(),
                assigned_runway: runway_ref.to_string(),
                assigned_gate: gate_ref.to_string(),
            },
            route,
            route_index: 0,
            x: start.x,
            y: start.y,
            heading_deg: 0.0,
            ground_speed_kt: 0.0,
            hold_short_node: Some(runway_node),
            cleared_for_takeoff: false,
            cleared_to_land: false,
            cleared_pushback: false,
        };
        self.aircraft.insert(callsign.to_string(), aircraft);
        Ok(())
    }

    pub fn spawn_arrival(
        &mut self,
        callsign: &str,
        aircraft_type: &str,
        runway_ref: &str,
        landing_end: &str,
        gate_ref: &str,
    ) -> Result<(), String> {
        let threshold_node = self
            .runway_threshold_node(runway_ref, landing_end)
            .ok_or_else(|| format!("unknown runway {runway_ref}"))?;
        let gate_node = self
            .gate_node(gate_ref)
            .ok_or_else(|| format!("unknown gate {gate_ref}"))?;

        let route = self
            .graph
            .find_path(&threshold_node, &gate_node)
            .ok_or_else(|| format!("no taxi route from runway {runway_ref} to gate {gate_ref}"))?;

        let start = &self.graph.nodes[&threshold_node];
        let aircraft = Aircraft {
            callsign: callsign.to_string(),
            aircraft_type: aircraft_type.to_string(),
            state: AircraftState::LandingRollout,
            flight_plan: FlightPlan {
                callsign: callsign.to_string(),
                aircraft_type: aircraft_type.to_string(),
                rule: FlightRule::Arrival,
                origin: "----".to_string(),
                destination: self.airport.icao.clone(),
                assigned_runway: runway_ref.to_string(),
                assigned_gate: gate_ref.to_string(),
            },
            route,
            route_index: 0,
            x: start.x,
            y: start.y,
            heading_deg: 0.0,
            ground_speed_kt: LANDING_ROLLOUT_SPEED_KT,
            hold_short_node: None,
            cleared_for_takeoff: false,
            cleared_to_land: true,
            cleared_pushback: false,
        };
        self.aircraft.insert(callsign.to_string(), aircraft);
        Ok(())
    }

    pub fn apply_clearance(&mut self, cmd: ClearanceCommand) -> Result<(), String> {
        // Pre-resolve anything that needs `&self` so the match body below can
        // hold a single `&mut Aircraft` borrow without conflicting with it.
        let gate_route = if let Clearance::TaxiToGate { ref gate_ref } = cmd.clearance {
            let gate_node = self
                .gate_node(gate_ref)
                .ok_or_else(|| format!("unknown gate {gate_ref}"))?;
            let current = self
                .aircraft
                .get(&cmd.callsign)
                .and_then(|ac| ac.target_node().cloned().or_else(|| ac.route.last().cloned()))
                .ok_or_else(|| format!("unknown callsign {}", cmd.callsign))?;
            let route = self
                .graph
                .find_path(&current, &gate_node)
                .ok_or_else(|| "no route to gate".to_string())?;
            Some(route)
        } else {
            None
        };

        let ac = self
            .aircraft
            .get_mut(&cmd.callsign)
            .ok_or_else(|| format!("unknown callsign {}", cmd.callsign))?;

        match cmd.clearance {
            Clearance::PushbackApproved => {
                if ac.state == AircraftState::AtGate {
                    ac.cleared_pushback = true;
                    ac.state = AircraftState::PushingBack;
                }
            }
            Clearance::TaxiToRunway { via_hold_short } => {
                if matches!(
                    ac.state,
                    AircraftState::AtGate | AircraftState::PushingBack
                ) {
                    ac.state = AircraftState::TaxiingToRunway;
                    if let Some(node) = via_hold_short {
                        ac.hold_short_node = Some(node);
                    }
                }
            }
            Clearance::TaxiToGate { gate_ref } => {
                ac.route = gate_route.expect("resolved above");
                ac.route_index = 0;
                ac.flight_plan.assigned_gate = gate_ref;
                ac.state = AircraftState::TaxiingToGate;
                ac.hold_short_node = None;
            }
            Clearance::HoldShort { node_id } => {
                ac.hold_short_node = Some(node_id);
                ac.state = AircraftState::HoldingShort;
            }
            Clearance::HoldPosition => {
                ac.ground_speed_kt = 0.0;
            }
            Clearance::ResumeTaxi => {
                if ac.state == AircraftState::HoldingShort {
                    ac.state = AircraftState::TaxiingToRunway;
                }
            }
            Clearance::LineUpAndWait => {
                ac.hold_short_node = None;
                ac.state = AircraftState::LinedUp;
            }
            Clearance::ClearedForTakeoff => {
                ac.hold_short_node = None;
                ac.cleared_for_takeoff = true;
                ac.state = AircraftState::TakeoffRoll;
                ac.ground_speed_kt = ac.ground_speed_kt.max(1.0);
            }
            Clearance::ClearedToLand => {
                ac.cleared_to_land = true;
            }
            Clearance::GoAround => {
                ac.state = AircraftState::Departed;
            }
            Clearance::CancelClearance => {
                ac.cleared_for_takeoff = false;
                ac.cleared_to_land = false;
                ac.cleared_pushback = false;
            }
        }
        Ok(())
    }

    pub fn tick(&mut self, dt_s: f64) -> Vec<SimEvent> {
        self.clock_s += dt_s;
        let mut events = Vec::new();
        let mut done: Vec<String> = Vec::new();

        for ac in self.aircraft.values_mut() {
            match ac.state {
                AircraftState::AtGate | AircraftState::Parked => continue,
                AircraftState::PushingBack => {
                    ac.ground_speed_kt = PUSHBACK_SPEED_KT;
                    advance_along_route(ac, dt_s, &self.graph);
                    if ac.cleared_pushback && ac.target_node().is_some() {
                        ac.state = AircraftState::TaxiingToRunway;
                    }
                }
                AircraftState::TaxiingToRunway | AircraftState::TaxiingToGate => {
                    ac.ground_speed_kt = TAXI_SPEED_KT;
                    let blocked = ac
                        .hold_short_node
                        .as_deref()
                        .is_some_and(|hs| ac.target_node().map(|t| t == hs).unwrap_or(false));
                    if blocked {
                        ac.ground_speed_kt = 0.0;
                        if ac.state == AircraftState::TaxiingToRunway {
                            ac.state = AircraftState::HoldingShort;
                        }
                        continue;
                    }
                    let reached_end = advance_along_route(ac, dt_s, &self.graph);
                    if reached_end {
                        ac.state = if ac.state == AircraftState::TaxiingToGate {
                            AircraftState::Parked
                        } else {
                            AircraftState::HoldingShort
                        };
                        ac.ground_speed_kt = 0.0;
                    }
                }
                AircraftState::HoldingShort | AircraftState::LinedUp => {
                    ac.ground_speed_kt = 0.0;
                }
                AircraftState::TakeoffRoll => {
                    ac.ground_speed_kt =
                        (ac.ground_speed_kt + TAKEOFF_ROLL_ACCEL_KT_PER_S * dt_s)
                            .min(TAKEOFF_DECISION_SPEED_KT + 20.0);
                    advance_along_route(ac, dt_s, &self.graph);
                    if ac.ground_speed_kt >= TAKEOFF_DECISION_SPEED_KT {
                        ac.state = AircraftState::Departed;
                        events.push(SimEvent {
                            callsign: ac.callsign.clone(),
                            message: "airborne, departing area".to_string(),
                        });
                    }
                }
                AircraftState::Departed => {
                    done.push(ac.callsign.clone());
                }
                AircraftState::OnApproach => {
                    // Final approach is handled outside the surface sim for v1;
                    // arrivals are spawned directly into LandingRollout.
                }
                AircraftState::LandingRollout => {
                    ac.ground_speed_kt =
                        (ac.ground_speed_kt - LANDING_DECEL_KT_PER_S * dt_s)
                            .max(LANDING_EXIT_SPEED_KT);
                    let reached_end = advance_along_route(ac, dt_s, &self.graph);
                    if ac.ground_speed_kt <= LANDING_EXIT_SPEED_KT || reached_end {
                        ac.state = AircraftState::TaxiingToGate;
                    }
                }
            }
        }

        for cs in done {
            self.aircraft.remove(&cs);
        }

        events
    }
}

/// Moves an aircraft toward its current route target at its current ground
/// speed, advancing through route nodes as it arrives. Returns true once the
/// aircraft has consumed the entire route.
fn advance_along_route(ac: &mut Aircraft, dt_s: f64, graph: &TaxiGraph) -> bool {
    if ac.route.is_empty() {
        return true;
    }
    let mut remaining = ac.ground_speed_kt * KT_TO_MPS * dt_s;

    loop {
        if ac.route_index >= ac.route.len() {
            return true;
        }
        let target_id = &ac.route[ac.route_index];
        let target = match graph.nodes.get(target_id) {
            Some(n) => n,
            None => return true,
        };
        let dx = target.x - ac.x;
        let dy = target.y - ac.y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= remaining || dist < 0.01 {
            ac.x = target.x;
            ac.y = target.y;
            if dist > 0.01 {
                ac.heading_deg = (dx.atan2(dy).to_degrees() + 360.0) % 360.0;
            }
            remaining -= dist;
            ac.route_index += 1;
            if ac.route_index >= ac.route.len() {
                return true;
            }
            if remaining <= 0.0 {
                return false;
            }
        } else {
            let ratio = remaining / dist;
            ac.x += dx * ratio;
            ac.y += dy * ratio;
            ac.heading_deg = (dx.atan2(dy).to_degrees() + 360.0) % 360.0;
            return false;
        }
    }
}
