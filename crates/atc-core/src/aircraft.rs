use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FlightRule {
    Departure,
    Arrival,
}

/// The position the human controller is actually working this session.
/// Every other position runs on a simple AI timer (see
/// Simulation::apply_automation) so a single-position session still
/// produces a complete, moving traffic flow instead of aircraft stuck
/// waiting forever for a clearance nobody is there to issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControllerRole {
    Ramp,
    Ground,
    Tower,
    Approach,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AircraftState {
    AtGate,
    PushingBack,
    ReadyForTaxi,
    TaxiingToRunway,
    HoldingShort,
    LinedUp,
    TakeoffRoll,
    Departed,
    OnApproach,
    LandingRollout,
    TaxiingToGate,
    Parked,
}

impl AircraftState {
    /// Which position is actually responsible for an aircraft in this
    /// phase, so apply_clearance can refuse a clearance from a controller
    /// who isn't working that position - a big airport really does split
    /// ramp/ground/tower, and ground issuing a takeoff clearance isn't a
    /// thing that happens for real just because the button exists.
    pub fn owning_role(self) -> ControllerRole {
        match self {
            AircraftState::AtGate | AircraftState::PushingBack | AircraftState::Parked => {
                ControllerRole::Ramp
            }
            AircraftState::ReadyForTaxi
            | AircraftState::TaxiingToRunway
            | AircraftState::TaxiingToGate => ControllerRole::Ground,
            AircraftState::HoldingShort
            | AircraftState::LinedUp
            | AircraftState::TakeoffRoll
            | AircraftState::Departed
            | AircraftState::OnApproach
            | AircraftState::LandingRollout => ControllerRole::Tower,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlightPlan {
    pub callsign: String,
    pub aircraft_type: String,
    pub rule: FlightRule,
    pub origin: String,
    pub destination: String,
    pub assigned_runway: String,
    pub assigned_gate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aircraft {
    pub callsign: String,
    pub aircraft_type: String,
    pub state: AircraftState,
    pub flight_plan: FlightPlan,
    /// Node id path the aircraft is currently following on the taxi graph.
    pub route: Vec<String>,
    pub route_index: usize,
    /// Route index where the gate_link portion of the route ends and the
    /// taxiway network begins - how far PushingBack actually has to travel
    /// before the aircraft is clear of the gate and ready for an explicit
    /// taxi clearance, rather than treating the whole gate-to-runway route
    /// as "still pushing back".
    pub pushback_end_index: usize,
    pub x: f64,
    pub y: f64,
    pub heading_deg: f64,
    pub ground_speed_kt: f64,
    /// Node id of a hold-short restriction, if any; aircraft will not
    /// proceed past this point until the restriction is cleared.
    pub hold_short_node: Option<String>,
    pub cleared_for_takeoff: bool,
    pub cleared_to_land: bool,
    pub cleared_pushback: bool,
    /// Ramp's separate "cleared to start engines" step, issued before
    /// pushback - real ramp phraseology, not just cosmetic: pushback can't
    /// be cleared until this is true.
    pub engine_start_approved: bool,
    /// True while an AI-generated readback is being spoken for this
    /// aircraft, so the display can ring whoever is "on frequency".
    pub is_speaking: bool,
    /// Sim clock timestamp (seconds) when this aircraft reached Parked, so
    /// it can be despawned after a realistic gate dwell time.
    pub parked_at_s: Option<f64>,
    /// Sim clock timestamp when this aircraft became ready for the next
    /// clearance an uncontrolled position would issue (ramp's pushback,
    /// tower's takeoff clearance) - None once that's been handled, either
    /// by the human controller or by apply_automation's AI timer.
    pub ready_since_s: Option<f64>,
}

impl Aircraft {
    pub fn target_node(&self) -> Option<&String> {
        self.route.get(self.route_index)
    }

    pub fn is_at_route_end(&self) -> bool {
        self.route_index + 1 >= self.route.len()
    }
}
