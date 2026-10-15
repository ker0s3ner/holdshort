use serde::{Deserialize, Serialize};

/// Clearances an ATC controller (the player) can issue to an aircraft.
/// Mirrors real ground/tower phraseology so the command bar can map
/// typed/structured input directly onto these.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Clearance {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearanceCommand {
    pub callsign: String,
    pub clearance: Clearance,
}
