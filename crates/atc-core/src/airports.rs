use crate::model::AirportData;

const KBUR_JSON: &str = include_str!("../data/kbur.json");

/// Airports bundled with the simulator, each built from real-world
/// OpenStreetMap surface geometry (see tools/convert_airport.py).
pub fn available_icaos() -> Vec<&'static str> {
    vec!["KBUR"]
}

pub fn load(icao: &str) -> Result<AirportData, String> {
    match icao {
        "KBUR" => AirportData::from_json_str(KBUR_JSON).map_err(|e| e.to_string()),
        other => Err(format!("unknown airport {other}")),
    }
}
