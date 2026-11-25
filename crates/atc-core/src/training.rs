use crate::aircraft::{Aircraft, AircraftState};
use serde::{Deserialize, Serialize};

pub const RUNWAY_PROXIMITY_M: f64 = 300.0;
pub const TAXI_CONFLICT_PROXIMITY_M: f64 = 60.0;
pub const AIRBORNE_HORIZONTAL_SEPARATION_M: f64 = 5.0 * 1852.0;
pub const AIRBORNE_VERTICAL_SEPARATION_FT: f64 = 1000.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrainingEventKind {
    RunwayConflict,
    RunwayIncursion,
    TaxiConflict,
    LossOfSeparation,
    UnsafeClearance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingEvent {
    pub id: u64,
    pub clock_s: f64,
    pub kind: TrainingEventKind,
    pub callsigns: Vec<String>,
    pub message: String,
    pub severity: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TrainingState {
    pub next_id: u64,
    pub events: Vec<TrainingEvent>,
    pub strict_safety: bool,
}

impl TrainingState {
    pub fn new(strict_safety: bool) -> Self {
        Self { next_id: 1, events: Vec::new(), strict_safety }
    }

    pub fn record(&mut self, clock_s: f64, kind: TrainingEventKind, callsigns: Vec<String>, message: String, severity: u8) {
        // Avoid repeating the same live alert every physics tick. A new event
        // is emitted once the pair/type has cleared for at least one tick.
        let duplicate = self.events.last().is_some_and(|previous| {
            previous.kind == kind && previous.callsigns == callsigns && (clock_s - previous.clock_s).abs() < 2.0
        });
        if duplicate { return; }
        let id = self.next_id;
        self.next_id += 1;
        self.events.push(TrainingEvent { id, clock_s, kind, callsigns, message, severity });
        if self.events.len() > 1000 {
            self.events.drain(0..200);
        }
    }
}

fn ground_state(state: AircraftState) -> bool {
    matches!(state, AircraftState::PushingBack | AircraftState::TaxiingToRunway | AircraftState::TaxiingToGate | AircraftState::HoldingShort | AircraftState::LinedUp | AircraftState::TakeoffRoll | AircraftState::LandingRollout)
}

fn active_runway(state: AircraftState) -> bool {
    matches!(state, AircraftState::LinedUp | AircraftState::TakeoffRoll | AircraftState::LandingRollout)
}

fn distance(a: &Aircraft, b: &Aircraft) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

pub fn evaluate_safety(aircraft: &[&Aircraft], clock_s: f64, training: &mut TrainingState) {
    for (i, a) in aircraft.iter().enumerate() {
        for b in aircraft.iter().skip(i + 1) {
            let d = distance(a, b);
            let callsigns = vec![a.callsign.clone(), b.callsign.clone()];
            if a.flight_plan.assigned_runway == b.flight_plan.assigned_runway && active_runway(a.state) && active_runway(b.state) && d < 1500.0 {
                training.record(clock_s, TrainingEventKind::RunwayConflict, callsigns.clone(), format!("{} and {} occupy the same runway with only {:.0} m between them", a.callsign, b.callsign, d), 3);
            }
            if ground_state(a.state) && ground_state(b.state) && d < TAXI_CONFLICT_PROXIMITY_M {
                training.record(clock_s, TrainingEventKind::TaxiConflict, callsigns.clone(), format!("{} and {} are within {:.0} m on the movement area", a.callsign, b.callsign, d), 2);
            }
            let airborne_a = matches!(a.state, AircraftState::OnApproach | AircraftState::Departed);
            let airborne_b = matches!(b.state, AircraftState::OnApproach | AircraftState::Departed);
            if airborne_a && airborne_b && d < AIRBORNE_HORIZONTAL_SEPARATION_M && (a.altitude_ft - b.altitude_ft).abs() < AIRBORNE_VERTICAL_SEPARATION_FT {
                training.record(clock_s, TrainingEventKind::LossOfSeparation, callsigns.clone(), format!("{} and {} are inside 5 NM / 1,000 ft separation", a.callsign, b.callsign), 3);
            }
            let runway_active = (a.flight_plan.assigned_runway == b.flight_plan.assigned_runway) && (active_runway(a.state) || active_runway(b.state));
            if runway_active && ((ground_state(a.state) && !active_runway(a.state)) || (ground_state(b.state) && !active_runway(b.state))) && d < RUNWAY_PROXIMITY_M {
                training.record(clock_s, TrainingEventKind::RunwayIncursion, callsigns, format!("{} and {} are conflicting at a runway entrance", a.callsign, b.callsign), 3);
            }
        }
    }
}
