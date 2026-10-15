use crate::model::AirportData;
use serde::Serialize;

macro_rules! bundled_airport {
    ($icao:literal, $file:literal) => {
        (
            $icao,
            include_str!(concat!("../data/", $file)),
        )
    };
}

/// Airports bundled with the simulator, each built from real-world
/// OpenStreetMap surface geometry (see tools/convert_airport.py). Airports
/// that failed to fetch simply aren't in this list yet — `load` returns a
/// clear error for anything not here.
const BUNDLED: &[(&str, &str)] = &[
    bundled_airport!("KBUR", "kbur.json"),
    bundled_airport!("EGKK", "egkk.json"),
    bundled_airport!("KJFK", "kjfk.json"),
    bundled_airport!("KATL", "katl.json"),
    bundled_airport!("OMDB", "omdb.json"),
    bundled_airport!("RJTT", "rjtt.json"),
    bundled_airport!("EGLL", "egll.json"),
    bundled_airport!("KDFW", "kdfw.json"),
    bundled_airport!("KORD", "kord.json"),
    bundled_airport!("LTFM", "ltfm.json"),
    bundled_airport!("KLAX", "klax.json"),
    bundled_airport!("EDDF", "eddf.json"),
];

#[derive(Debug, Clone, Serialize)]
pub struct AirportSummary {
    pub icao: String,
    pub name: String,
}

pub fn available_airports() -> Vec<AirportSummary> {
    BUNDLED
        .iter()
        .map(|(icao, json)| AirportSummary {
            icao: icao.to_string(),
            name: summary_name(json).unwrap_or_else(|| icao.to_string()),
        })
        .collect()
}

fn summary_name(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("name")?.as_str().map(|s| s.to_string())
}

pub fn load(icao: &str) -> Result<AirportData, String> {
    BUNDLED
        .iter()
        .find(|(code, _)| *code == icao)
        .map(|(_, json)| AirportData::from_json_str(json).map_err(|e| e.to_string()))
        .unwrap_or_else(|| Err(format!("unknown or not-yet-fetched airport {icao}")))
}
