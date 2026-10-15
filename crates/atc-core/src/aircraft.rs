use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FlightRule {
    Departure,
    Arrival,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AircraftState {
    AtGate,
    PushingBack,
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
    /// True while an AI-generated readback is being spoken for this
    /// aircraft, so the display can ring whoever is "on frequency".
    pub is_speaking: bool,
    /// Sim clock timestamp (seconds) when this aircraft reached Parked, so
    /// it can be despawned after a realistic gate dwell time.
    pub parked_at_s: Option<f64>,
}

impl Aircraft {
    pub fn target_node(&self) -> Option<&String> {
        self.route.get(self.route_index)
    }

    pub fn is_at_route_end(&self) -> bool {
        self.route_index + 1 >= self.route.len()
    }
}
