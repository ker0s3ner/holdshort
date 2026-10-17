use crate::aircraft::{Aircraft, AircraftState, ControllerRole, FlightPlan, FlightRule};
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
/// How long a parked arrival sits at the gate before despawning (deplaning
/// + a plausible turnaround), freeing the gate for the next spawn.
const GATE_DWELL_S: f64 = 150.0;
/// How long an AI ramp position takes to clear an aircraft for pushback
/// when the human controller isn't working ramp themselves.
const AUTO_PUSHBACK_DELAY_S: f64 = 25.0;
/// How long an AI tower position takes to clear a holding-short aircraft
/// for takeoff when the human controller isn't working tower themselves.
const AUTO_TAKEOFF_DELAY_S: f64 = 20.0;
/// How long an AI ground position takes to issue a taxi clearance to an
/// aircraft that has finished pushback and is sitting ready, when the human
/// controller isn't working ground themselves.
const AUTO_TAXI_DELAY_S: f64 = 15.0;
/// How far behind the threshold an arrival spawns on final (~18nm) -
/// close enough to keep the approach visible/short, far enough to give a
/// real controller something to vector.
const APPROACH_SPAWN_DISTANCE_M: f64 = 33_000.0;
const APPROACH_INITIAL_SPEED_KT: f64 = 180.0;
const APPROACH_FINAL_SPEED_KT: f64 = 130.0;
const APPROACH_SPEED_ACCEL_KT_PER_S: f64 = 2.0;
/// ~1500 ft/min, a standard descent rate.
const APPROACH_ALT_RATE_FPS: f64 = 25.0;
/// Standard-rate turn.
const APPROACH_TURN_RATE_DEG_PER_S: f64 = 3.0;
/// A rough 3-degree glideslope (~300ft per nautical mile) used as the
/// default altitude target when Approach hasn't assigned one.
const GLIDESLOPE_FT_PER_M: f64 = 300.0 / 1852.0;
/// How long an AI approach position takes to clear an arrival for the
/// approach when the human controller isn't working approach themselves.
const AUTO_APPROACH_CLEARANCE_DELAY_S: f64 = 20.0;
const DEPARTURE_CRUISE_ALT_FT: f64 = 10_000.0;
/// ~1800 ft/min initial climb.
const DEPARTURE_CLIMB_RATE_FPS: f64 = 30.0;
/// How long a departure stays visible climbing out before being handed
/// off/removed, win or lose on reaching DEPARTURE_CRUISE_ALT_FT first.
const DEPARTURE_VISIBLE_MAX_S: f64 = 90.0;

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
        let clock_s = local_clock_seconds(airport.reference_point.lon);
        Simulation {
            airport,
            graph,
            aircraft: HashMap::new(),
            clock_s,
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

        // How many legs of the route are still "gate_link" (the short
        // connector off the gate/apron) - that's the pushback maneuver.
        // Once the aircraft clears those, it's on the taxiway network and
        // needs an actual taxi clearance from ground, not just a pushback.
        let mut pushback_end_index = 0;
        while pushback_end_index + 1 < route.len()
            && self
                .graph
                .edge_kind(&route[pushback_end_index], &route[pushback_end_index + 1])
                == Some("gate_link")
        {
            pushback_end_index += 1;
        }

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
            pushback_end_index,
            runway_exit_index: 0,
            x: start.x,
            y: start.y,
            heading_deg: 0.0,
            ground_speed_kt: 0.0,
            hold_short_node: Some(runway_node),
            cleared_for_takeoff: false,
            cleared_to_land: false,
            cleared_pushback: false,
            engine_start_approved: false,
            is_speaking: false,
            parked_at_s: None,
            ready_since_s: Some(self.clock_s),
            altitude_ft: 0.0,
            assigned_heading_deg: None,
            assigned_altitude_ft: None,
            assigned_speed_kt: None,
            cleared_approach: false,
            departed_at_s: None,
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
        let rw = self
            .airport
            .runways
            .iter()
            .find(|r| r.ref_ == runway_ref)
            .ok_or_else(|| format!("unknown runway {runway_ref}"))?;
        let far_end_node = if rw.node_start == threshold_node {
            rw.node_end.clone()
        } else {
            rw.node_start.clone()
        };

        let (route, runway_exit_index) = self
            .graph
            .find_arrival_path(&threshold_node, &far_end_node, &gate_node)
            .ok_or_else(|| format!("no taxi route from runway {runway_ref} to gate {gate_ref}"))?;

        // Spawn out on final rather than straight onto the runway - the
        // inbound course is the direction of travel while landing (from
        // the far end toward the threshold), and the spawn point sits
        // APPROACH_SPAWN_DISTANCE_M behind the threshold along that course.
        let threshold = &self.graph.nodes[&threshold_node];
        let far = &self.graph.nodes[&far_end_node];
        let dx = threshold.x - far.x;
        let dy = threshold.y - far.y;
        let dist = (dx * dx + dy * dy).sqrt().max(1.0);
        let (ux, uy) = (dx / dist, dy / dist);
        let inbound_heading = (ux.atan2(uy).to_degrees() + 360.0) % 360.0;
        let start_x = threshold.x - ux * APPROACH_SPAWN_DISTANCE_M;
        let start_y = threshold.y - uy * APPROACH_SPAWN_DISTANCE_M;

        let aircraft = Aircraft {
            callsign: callsign.to_string(),
            aircraft_type: aircraft_type.to_string(),
            state: AircraftState::OnApproach,
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
            pushback_end_index: 0,
            runway_exit_index,
            x: start_x,
            y: start_y,
            heading_deg: inbound_heading,
            ground_speed_kt: APPROACH_INITIAL_SPEED_KT,
            hold_short_node: None,
            cleared_for_takeoff: false,
            cleared_to_land: true,
            cleared_pushback: false,
            engine_start_approved: false,
            is_speaking: false,
            parked_at_s: None,
            ready_since_s: Some(self.clock_s),
            // Matches the default glideslope target for this distance, so
            // the aircraft is already descending from the moment it
            // spawns instead of climbing to "catch up" to the glideslope.
            altitude_ft: APPROACH_SPAWN_DISTANCE_M * GLIDESLOPE_FT_PER_M,
            assigned_heading_deg: None,
            assigned_altitude_ft: None,
            assigned_speed_kt: None,
            cleared_approach: false,
            departed_at_s: None,
        };
        self.aircraft.insert(callsign.to_string(), aircraft);
        Ok(())
    }

    /// Toggles the "on frequency" indicator for an aircraft (used to ring
    /// whoever is currently speaking on the display), independent of
    /// controller selection.
    pub fn set_speaking(&mut self, callsign: &str, speaking: bool) {
        if let Some(ac) = self.aircraft.get_mut(callsign) {
            ac.is_speaking = speaking;
        }
    }

    pub fn apply_clearance(
        &mut self,
        cmd: ClearanceCommand,
        active_role: ControllerRole,
    ) -> Result<(), String> {
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

        let owner = ac.state.owning_role();
        if owner != active_role {
            return Err(format!(
                "{} is {:?}'s aircraft right now, not {:?}'s",
                cmd.callsign, owner, active_role
            ));
        }

        match cmd.clearance {
            Clearance::EngineStartApproved => {
                if ac.state == AircraftState::AtGate {
                    ac.engine_start_approved = true;
                }
            }
            Clearance::PushbackApproved => {
                if ac.state == AircraftState::AtGate {
                    if !ac.engine_start_approved {
                        return Err(format!(
                            "{} hasn't been cleared to start engines yet",
                            cmd.callsign
                        ));
                    }
                    ac.cleared_pushback = true;
                    ac.state = AircraftState::PushingBack;
                    ac.ready_since_s = None;
                }
            }
            Clearance::TaxiToRunway { via_hold_short } => {
                if matches!(
                    ac.state,
                    AircraftState::AtGate | AircraftState::PushingBack | AircraftState::ReadyForTaxi
                ) {
                    ac.state = AircraftState::TaxiingToRunway;
                    ac.ready_since_s = None;
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
                ac.ready_since_s = None;
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
                ac.ready_since_s = None;
            }
            Clearance::ClearedForTakeoff => {
                ac.hold_short_node = None;
                ac.cleared_for_takeoff = true;
                ac.state = AircraftState::TakeoffRoll;
                ac.ground_speed_kt = ac.ground_speed_kt.max(1.0);
                ac.ready_since_s = None;
            }
            Clearance::ClearedToLand => {
                ac.cleared_to_land = true;
            }
            Clearance::GoAround => {
                ac.state = AircraftState::Departed;
                ac.departed_at_s = Some(self.clock_s);
            }
            Clearance::CancelClearance => {
                ac.cleared_for_takeoff = false;
                ac.cleared_to_land = false;
                ac.cleared_pushback = false;
            }
            Clearance::Vector { heading_deg } => {
                ac.assigned_heading_deg = Some(heading_deg.rem_euclid(360.0));
            }
            Clearance::DescendAndMaintain { altitude_ft } | Clearance::ClimbAndMaintain { altitude_ft } => {
                ac.assigned_altitude_ft = Some(altitude_ft.max(0.0));
            }
            Clearance::AssignSpeed { speed_kt } => {
                ac.assigned_speed_kt = Some(speed_kt.max(0.0));
            }
            Clearance::ClearedApproach => {
                ac.cleared_approach = true;
                ac.assigned_heading_deg = None;
            }
        }
        Ok(())
    }

    pub fn tick(&mut self, dt_s: f64) -> Vec<SimEvent> {
        self.clock_s = (self.clock_s + dt_s) % 86400.0;
        let mut events = Vec::new();
        let mut done: Vec<String> = Vec::new();

        for ac in self.aircraft.values_mut() {
            match ac.state {
                AircraftState::AtGate | AircraftState::ReadyForTaxi => continue,
                AircraftState::Parked => {
                    match ac.parked_at_s {
                        Some(since) if self.clock_s - since >= GATE_DWELL_S => {
                            done.push(ac.callsign.clone());
                        }
                        Some(_) => {}
                        None => ac.parked_at_s = Some(self.clock_s),
                    }
                    continue;
                }
                AircraftState::PushingBack => {
                    ac.ground_speed_kt = PUSHBACK_SPEED_KT;
                    advance_along_route(ac, dt_s, &self.graph);
                    if ac.cleared_pushback && ac.route_index >= ac.pushback_end_index {
                        ac.ground_speed_kt = 0.0;
                        ac.state = AircraftState::ReadyForTaxi;
                        ac.ready_since_s = Some(self.clock_s);
                        events.push(SimEvent {
                            callsign: ac.callsign.clone(),
                            message: "clear of the gate, ready to taxi".to_string(),
                        });
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
                        if ac.state == AircraftState::TaxiingToGate {
                            ac.state = AircraftState::Parked;
                        } else {
                            ac.state = AircraftState::HoldingShort;
                            ac.ready_since_s = Some(self.clock_s);
                            // Pilots don't wait to be asked - they check in
                            // the moment they're holding short and ready.
                            events.push(SimEvent {
                                callsign: ac.callsign.clone(),
                                message: format!(
                                    "holding short runway {}, ready for departure",
                                    ac.flight_plan.assigned_runway
                                ),
                            });
                        }
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
                        ac.departed_at_s = Some(self.clock_s);
                        events.push(SimEvent {
                            callsign: ac.callsign.clone(),
                            message: "airborne, climbing out".to_string(),
                        });
                    }
                }
                AircraftState::Departed => {
                    // A bounded, visible climb-out instead of vanishing the
                    // instant takeoff speed is hit - Approach's airspace,
                    // responds to Vector/ClimbAndMaintain/AssignSpeed like
                    // OnApproach does, until it reaches cruise or simply
                    // flies far enough out to hand off.
                    let since = ac.departed_at_s.unwrap_or(self.clock_s);
                    let target_heading = ac.assigned_heading_deg.unwrap_or(ac.heading_deg);
                    turn_toward(ac, target_heading, dt_s);
                    let target_speed = ac.assigned_speed_kt.unwrap_or(250.0);
                    ac.ground_speed_kt =
                        ease_toward(ac.ground_speed_kt, target_speed, APPROACH_SPEED_ACCEL_KT_PER_S * dt_s);
                    let target_alt = ac.assigned_altitude_ft.unwrap_or(DEPARTURE_CRUISE_ALT_FT);
                    ac.altitude_ft = ease_toward(ac.altitude_ft, target_alt, DEPARTURE_CLIMB_RATE_FPS * dt_s);
                    let move_dist = ac.ground_speed_kt * KT_TO_MPS * dt_s;
                    let heading_rad = ac.heading_deg.to_radians();
                    ac.x += heading_rad.sin() * move_dist;
                    ac.y += heading_rad.cos() * move_dist;
                    if ac.altitude_ft >= DEPARTURE_CRUISE_ALT_FT
                        || self.clock_s - since >= DEPARTURE_VISIBLE_MAX_S
                    {
                        done.push(ac.callsign.clone());
                    }
                }
                AircraftState::OnApproach => {
                    let Some(threshold) = ac.route.first().and_then(|id| self.graph.nodes.get(id)) else {
                        continue;
                    };
                    let dx = threshold.x - ac.x;
                    let dy = threshold.y - ac.y;
                    let dist_m = (dx * dx + dy * dy).sqrt();
                    let direct_heading = (dx.atan2(dy).to_degrees() + 360.0) % 360.0;
                    let target_heading = ac.assigned_heading_deg.unwrap_or(direct_heading);
                    turn_toward(ac, target_heading, dt_s);

                    let dist_nm = dist_m / 1852.0;
                    let default_speed = APPROACH_FINAL_SPEED_KT
                        + (dist_nm.min(10.0) / 10.0) * (APPROACH_INITIAL_SPEED_KT - APPROACH_FINAL_SPEED_KT);
                    let target_speed = ac.assigned_speed_kt.unwrap_or(default_speed);
                    ac.ground_speed_kt =
                        ease_toward(ac.ground_speed_kt, target_speed, APPROACH_SPEED_ACCEL_KT_PER_S * dt_s);

                    let default_alt = (dist_m * GLIDESLOPE_FT_PER_M).max(0.0);
                    let target_alt = ac.assigned_altitude_ft.unwrap_or(default_alt);
                    ac.altitude_ft = ease_toward(ac.altitude_ft, target_alt, APPROACH_ALT_RATE_FPS * dt_s);

                    let move_dist = ac.ground_speed_kt * KT_TO_MPS * dt_s;
                    if ac.cleared_approach && dist_m <= move_dist.max(50.0) {
                        let (tx, ty) = (threshold.x, threshold.y);
                        ac.x = tx;
                        ac.y = ty;
                        ac.altitude_ft = 0.0;
                        ac.ground_speed_kt = LANDING_ROLLOUT_SPEED_KT;
                        ac.state = AircraftState::LandingRollout;
                        ac.ready_since_s = None;
                        events.push(SimEvent {
                            callsign: ac.callsign.clone(),
                            message: "over the threshold".to_string(),
                        });
                    } else if !ac.cleared_approach && dist_m < 500.0 {
                        // Not cleared and about to reach the runway - hold
                        // rather than land itself without a clearance.
                        ac.ground_speed_kt = 0.0;
                    } else {
                        let heading_rad = ac.heading_deg.to_radians();
                        ac.x += heading_rad.sin() * move_dist;
                        ac.y += heading_rad.cos() * move_dist;
                    }
                }
                AircraftState::LandingRollout => {
                    // Decelerating toward the exit speed paces the rollout
                    // realistically, but the transition itself is gated on
                    // actually reaching the runway-exit node
                    // (runway_exit_index) - not on speed alone, which would
                    // otherwise hit the floor and "vacate" almost instantly
                    // regardless of how much runway is actually left.
                    ac.ground_speed_kt =
                        (ac.ground_speed_kt - LANDING_DECEL_KT_PER_S * dt_s)
                            .max(LANDING_EXIT_SPEED_KT);
                    advance_along_route(ac, dt_s, &self.graph);
                    if ac.route_index >= ac.runway_exit_index {
                        ac.ground_speed_kt = 0.0;
                        ac.state = AircraftState::ReadyForTaxi;
                        ac.ready_since_s = Some(self.clock_s);
                        events.push(SimEvent {
                            callsign: ac.callsign.clone(),
                            message: "runway vacated, ready to taxi".to_string(),
                        });
                    }
                }
            }
        }

        for cs in done {
            self.aircraft.remove(&cs);
        }

        events
    }

    /// Runs every position the human controller *isn't* working on a
    /// simple AI timer, so a single-position session still produces a
    /// complete, moving traffic flow instead of aircraft stuck waiting
    /// forever for a clearance nobody is there to issue - a ground-only
    /// session still sees ramp push its aircraft and tower launch them,
    /// just on a plausible delay rather than instantly.
    pub fn apply_automation(&mut self, active_role: ControllerRole) {
        let clock = self.clock_s;
        let callsigns: Vec<String> = self.aircraft.keys().cloned().collect();

        for cs in &callsigns {
            let Some(ac) = self.aircraft.get(cs) else { continue };
            let Some(since) = ac.ready_since_s else { continue };

            match ac.state {
                AircraftState::AtGate if active_role != ControllerRole::Ramp => {
                    if clock - since >= AUTO_PUSHBACK_DELAY_S {
                        if let Some(ac) = self.aircraft.get_mut(cs) {
                            ac.cleared_pushback = true;
                            ac.state = AircraftState::PushingBack;
                            ac.ready_since_s = None;
                        }
                    }
                }
                AircraftState::ReadyForTaxi if active_role != ControllerRole::Ground => {
                    if clock - since < AUTO_TAXI_DELAY_S {
                        continue;
                    }
                    if ac.flight_plan.rule == FlightRule::Departure {
                        if let Some(ac) = self.aircraft.get_mut(cs) {
                            ac.state = AircraftState::TaxiingToRunway;
                            ac.ready_since_s = None;
                        }
                    } else {
                        // Arrival ready to taxi but ground isn't worked -
                        // auto-clear it to its already-assigned gate, same
                        // route a TaxiToGate clearance would compute.
                        let gate_ref = ac.flight_plan.assigned_gate.clone();
                        let current = ac
                            .target_node()
                            .cloned()
                            .or_else(|| ac.route.last().cloned());
                        if let (Some(gate_node), Some(current)) =
                            (self.gate_node(&gate_ref), current)
                        {
                            if let Some(route) = self.graph.find_path(&current, &gate_node) {
                                if let Some(ac) = self.aircraft.get_mut(cs) {
                                    ac.route = route;
                                    ac.route_index = 0;
                                    ac.state = AircraftState::TaxiingToGate;
                                    ac.hold_short_node = None;
                                    ac.ready_since_s = None;
                                }
                            }
                        }
                    }
                }
                AircraftState::OnApproach
                    if active_role != ControllerRole::Approach && !ac.cleared_approach =>
                {
                    if clock - since >= AUTO_APPROACH_CLEARANCE_DELAY_S {
                        if let Some(ac) = self.aircraft.get_mut(cs) {
                            ac.cleared_approach = true;
                        }
                    }
                }
                AircraftState::HoldingShort if active_role != ControllerRole::Tower => {
                    if clock - since < AUTO_TAKEOFF_DELAY_S {
                        continue;
                    }
                    let rwy = ac.flight_plan.assigned_runway.clone();
                    let runway_occupied = self.aircraft.values().any(|other| {
                        &other.callsign != cs
                            && other.flight_plan.assigned_runway == rwy
                            && matches!(
                                other.state,
                                AircraftState::TakeoffRoll
                                    | AircraftState::LinedUp
                                    | AircraftState::LandingRollout
                            )
                    });
                    if runway_occupied {
                        continue;
                    }
                    if let Some(ac) = self.aircraft.get_mut(cs) {
                        ac.hold_short_node = None;
                        ac.cleared_for_takeoff = true;
                        ac.state = AircraftState::TakeoffRoll;
                        ac.ground_speed_kt = ac.ground_speed_kt.max(1.0);
                        ac.ready_since_s = None;
                    }
                }
                _ => {}
            }
        }
    }
}

/// Approximates the airport's local clock (seconds since local midnight)
/// from the current UTC time and the airport's longitude. This is a
/// solar-time approximation (15 degrees of longitude per hour), not a real
/// IANA timezone/DST lookup - close enough for a sim clock without pulling
/// in a timezone-boundary database.
fn local_clock_seconds(lon_deg: f64) -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    let utc_seconds_since_midnight = now % 86400.0;
    let offset_hours = (lon_deg / 15.0).round();
    (utc_seconds_since_midnight + offset_hours * 3600.0).rem_euclid(86400.0)
}

/// Standard-rate turn toward a target heading, always the shorter way
/// around - used for airborne flight (OnApproach/Departed), which isn't
/// constrained to the taxi graph's node-to-node headings.
fn turn_toward(ac: &mut Aircraft, target_heading_deg: f64, dt_s: f64) {
    let diff = ((target_heading_deg - ac.heading_deg + 540.0) % 360.0) - 180.0;
    let max_turn = APPROACH_TURN_RATE_DEG_PER_S * dt_s;
    ac.heading_deg = (ac.heading_deg + diff.clamp(-max_turn, max_turn) + 360.0) % 360.0;
}

/// Eases a value toward a target at a bounded rate per tick - shared by
/// altitude and speed changes so neither snaps instantly to an assigned
/// value.
fn ease_toward(current: f64, target: f64, max_delta: f64) -> f64 {
    current + (target - current).clamp(-max_delta, max_delta)
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
