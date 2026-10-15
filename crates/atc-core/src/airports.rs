use crate::model::AirportData;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// One airport the single still worth shipping with the app so a first
/// launch isn't an empty, network-dependent screen. Everything else is a
/// download, chosen from the catalog, so installing "every airport in the
/// world" never means shipping petabytes in the binary.
const STARTER_ICAO: &str = "KBUR";
const STARTER_JSON: &str = include_str!("../data/kbur.json");

/// Where the remote catalog and per-airport data files are published. Both
/// just serve files straight out of this git repo via GitHub's raw content
/// CDN, so adding a new airport to the data/ directory and pushing makes it
/// installable immediately - no app update required.
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/ker0s3ner/holdshort/main/crates/atc-core/data/catalog.json";
const DATA_BASE_URL: &str =
    "https://raw.githubusercontent.com/ker0s3ner/holdshort/main/crates/atc-core/data";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirportSummary {
    pub icao: String,
    pub name: String,
    #[serde(default)]
    pub region: String,
}

fn cache_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("airports")
}

fn cache_path(app_data_dir: &Path, icao: &str) -> PathBuf {
    cache_dir(app_data_dir).join(format!("{}.json", icao.to_lowercase()))
}

/// Airports installed right now: the bundled starter plus whatever has been
/// downloaded into the local cache directory.
pub fn list_installed(app_data_dir: &Path) -> Vec<AirportSummary> {
    let mut out = vec![AirportSummary {
        icao: STARTER_ICAO.to_string(),
        name: summary_name(STARTER_JSON).unwrap_or_else(|| STARTER_ICAO.to_string()),
        region: "United States".to_string(),
    }];

    if let Ok(entries) = fs::read_dir(cache_dir(app_data_dir)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let icao = stem.to_uppercase();
            if icao == STARTER_ICAO {
                continue; // already listed above
            }
            if let Ok(contents) = fs::read_to_string(&path) {
                out.push(AirportSummary {
                    icao: icao.clone(),
                    name: summary_name(&contents).unwrap_or(icao),
                    region: String::new(),
                });
            }
        }
    }
    out
}

pub fn is_installed(app_data_dir: &Path, icao: &str) -> bool {
    icao.eq_ignore_ascii_case(STARTER_ICAO) || cache_path(app_data_dir, icao).exists()
}

/// Fetches the full catalog of every airport that *could* be installed
/// (requires network - this is the only command that needs it besides the
/// install itself).
pub async fn fetch_catalog() -> Result<Vec<AirportSummary>, String> {
    let resp = reqwest::get(CATALOG_URL)
        .await
        .map_err(|e| format!("couldn't reach the airport catalog: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("catalog request returned {}", resp.status()));
    }
    resp.json::<Vec<AirportSummary>>()
        .await
        .map_err(|e| format!("couldn't parse the airport catalog: {e}"))
}

pub async fn install_airport(app_data_dir: &Path, icao: &str) -> Result<(), String> {
    let lc = icao.to_lowercase();
    let url = format!("{DATA_BASE_URL}/{lc}.json");
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{icao} isn't available ({})", resp.status()));
    }
    let bytes = resp
        .text()
        .await
        .map_err(|e| format!("couldn't read {icao}'s data: {e}"))?;

    // Sanity-check it parses as airport data before caching it, so a bad
    // download can't brick a later session silently.
    AirportData::from_json_str(&bytes).map_err(|e| format!("{icao}'s data looks corrupt: {e}"))?;

    let dir = cache_dir(app_data_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("couldn't create airport cache dir: {e}"))?;
    fs::write(cache_path(app_data_dir, icao), bytes)
        .map_err(|e| format!("couldn't save {icao}: {e}"))?;
    Ok(())
}

pub fn uninstall_airport(app_data_dir: &Path, icao: &str) -> Result<(), String> {
    if icao.eq_ignore_ascii_case(STARTER_ICAO) {
        return Err(format!("{STARTER_ICAO} ships with the app and can't be removed"));
    }
    let path = cache_path(app_data_dir, icao);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("couldn't remove {icao}: {e}"))?;
    }
    Ok(())
}

fn summary_name(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("name")?.as_str().map(|s| s.to_string())
}

pub fn load(app_data_dir: &Path, icao: &str) -> Result<AirportData, String> {
    if icao.eq_ignore_ascii_case(STARTER_ICAO) {
        return AirportData::from_json_str(STARTER_JSON).map_err(|e| e.to_string());
    }
    let path = cache_path(app_data_dir, icao);
    let contents = fs::read_to_string(&path)
        .map_err(|_| format!("{icao} isn't installed - add it from Manage Installed Regions"))?;
    AirportData::from_json_str(&contents).map_err(|e| e.to_string())
}
