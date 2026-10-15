use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub length_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Runway {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub ends: Vec<String>,
    pub width_m: Option<f64>,
    pub surface: Option<String>,
    pub node_start: String,
    pub node_end: String,
    pub heading_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParkingPosition {
    pub id: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub node: String,
    pub parking_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirportData {
    pub icao: String,
    pub name: String,
    pub reference_point: LatLon,
    pub attribution: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub runways: Vec<Runway>,
    pub parking_positions: Vec<ParkingPosition>,
}

impl AirportData {
    pub fn from_json_str(s: &str) -> serde_json::Result<Self> {
        serde_json::from_str(s)
    }

    pub fn node_map(&self) -> HashMap<&str, &Node> {
        self.nodes.iter().map(|n| (n.id.as_str(), n)).collect()
    }
}
