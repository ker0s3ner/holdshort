use serde::{Deserialize, Serialize};

/// Clearances an ATC controller (the player) can issue to an aircraft.
/// Mirrors real ground/tower phraseology so the command bar can map
/// typed/structured input directly onto these.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Clearance {
    EngineStartApproved,
    PushbackApproved,
    TaxiToRunway { via_hold_short: Option<String> },
    TaxiToGate { gate_ref: String },
    HoldShort { node_id: String },
    HoldPosition,
    ResumeTaxi,
    LineUpAndWait,
    ClearedForTakeoff,
    ClearedToLand,
    GoAround,
    CancelClearance,
    /// Approach vectoring - a fixed heading to fly, overriding the
    /// aircraft's own direct-to-threshold/climb-out default.
    Vector { heading_deg: f64 },
    DescendAndMaintain { altitude_ft: f64 },
    ClimbAndMaintain { altitude_ft: f64 },
    AssignSpeed { speed_kt: f64 },
    /// Required before an arrival will actually land - without it, an
    /// OnApproach aircraft holds short of the runway rather than landing
    /// itself just because it got close.
    ClearedApproach,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearanceCommand {
    pub callsign: String,
    pub clearance: Clearance,
}
