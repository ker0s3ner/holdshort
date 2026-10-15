use atc_core::airports::AirportSummary;
use atc_core::clearance::ClearanceCommand;
use atc_core::{airports, AircraftState, AirportData, FlightRule, Simulation, TrafficGenerator};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

struct ActiveRunway {
    rwy_ref: String,
    departure_end: String,
}

struct AppState {
    sim: Mutex<Simulation>,
    traffic: Mutex<TrafficGenerator>,
    active: Mutex<bool>,
    runway: Mutex<ActiveRunway>,
    data_dir: PathBuf,
}

#[derive(Serialize, Clone)]
struct AircraftSnapshot {
    callsign: String,
    aircraft_type: String,
    state: AircraftState,
    rule: FlightRule,
    x: f64,
    y: f64,
    heading_deg: f64,
    ground_speed_kt: f64,
    destination: String,
    origin: String,
    assigned_gate: String,
    assigned_runway: String,
    is_speaking: bool,
}

#[derive(Serialize, Clone)]
struct SimTick {
    clock_s: f64,
    aircraft: Vec<AircraftSnapshot>,
}

/// Airports installed on this machine right now - no network needed. This
/// is what the launcher and profile picker show.
#[tauri::command]
fn list_installed(state: tauri::State<AppState>) -> Vec<AirportSummary> {
    airports::list_installed(&state.data_dir)
}

/// The full catalog of every airport that *could* be installed - fetched
/// from the data repo, so it grows without needing an app update.
#[tauri::command]
async fn list_catalog() -> Result<Vec<AirportSummary>, String> {
    airports::fetch_catalog().await
}

#[tauri::command]
fn is_installed(state: tauri::State<AppState>, icao: String) -> bool {
    airports::is_installed(&state.data_dir, &icao)
}

#[tauri::command]
async fn install_airport(state: tauri::State<'_, AppState>, icao: String) -> Result<(), String> {
    airports::install_airport(&state.data_dir, &icao).await
}

#[tauri::command]
fn uninstall_airport(state: tauri::State<AppState>, icao: String) -> Result<(), String> {
    airports::uninstall_airport(&state.data_dir, &icao)
}

#[tauri::command]
fn start_session(state: tauri::State<AppState>, icao: String) -> Result<(), String> {
    let airport = airports::load(&state.data_dir, &icao)?;
    let (rwy_ref, departure_end) = airport
        .runways
        .first()
        .and_then(|r| r.ends.first().map(|e| (r.ref_.clone(), e.clone())))
        .ok_or_else(|| format!("{icao} has no runways defined"))?;

    // Busier (more gates) airports see more frequent traffic, like real
    // operations - a 27-gate field like Kaunas stays quiet, a 300+ gate hub
    // like Heathrow or Frankfurt spawns aircraft every few seconds.
    let gate_count = airport.parking_positions.len().max(1) as f64;
    let spawn_interval_s = (2200.0 / gate_count).clamp(6.0, 90.0);

    *state.sim.lock().unwrap() = Simulation::new(airport);
    *state.traffic.lock().unwrap() = TrafficGenerator::new(spawn_interval_s);
    *state.runway.lock().unwrap() = ActiveRunway {
        rwy_ref,
        departure_end,
    };
    *state.active.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn end_session(state: tauri::State<AppState>) {
    *state.active.lock().unwrap() = false;
}

#[tauri::command]
fn get_airport(state: tauri::State<AppState>) -> AirportData {
    state.sim.lock().unwrap().airport.clone()
}

#[tauri::command]
fn get_traffic(state: tauri::State<AppState>) -> SimTick {
    build_snapshot(&state.sim.lock().unwrap())
}

#[tauri::command]
fn issue_clearance(state: tauri::State<AppState>, command: ClearanceCommand) -> Result<(), String> {
    state.sim.lock().unwrap().apply_clearance(command)
}

#[tauri::command]
fn set_speaking(state: tauri::State<AppState>, callsign: String, speaking: bool) {
    state.sim.lock().unwrap().set_speaking(&callsign, speaking);
}

/// Real-world METAR for an airport, straight from aviationweather.gov's
/// public text data service (no API key needed). Fetched from the Rust
/// side so the webview's origin never hits that server's CORS policy.
#[tauri::command]
async fn get_metar(icao: String) -> Result<String, String> {
    let url = format!(
        "https://aviationweather.gov/api/data/metar?ids={}&format=raw",
        icao.to_uppercase()
    );
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("METAR request failed: {e}"))?;
    let text = resp
        .text()
        .await
        .map_err(|e| format!("METAR response read failed: {e}"))?;
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return Err(format!("no METAR available for {icao}"));
    }
    Ok(line.to_string())
}

#[derive(serde::Deserialize)]
struct OllamaResponse {
    response: String,
}

/// Asks a locally-running Ollama instance (e.g. `ollama run gemma2`) to
/// generate text - used for AI pilot readbacks. Fails clearly if Ollama
/// isn't running or the model isn't pulled, rather than pretending to work.
#[tauri::command]
async fn ask_ai(prompt: String, model: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({
        "model": model.unwrap_or_else(|| "gemma2".to_string()),
        "prompt": prompt,
        "stream": false,
    });
    let resp = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "Couldn't reach Ollama at localhost:11434 - install Ollama and run \
             `ollama pull gemma2`, then make sure it's running."
                .to_string()
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {text}"));
    }
    let parsed: OllamaResponse = resp
        .json()
        .await
        .map_err(|e| format!("couldn't parse Ollama response: {e}"))?;
    Ok(parsed.response.trim().to_string())
}

#[derive(Serialize, Clone)]
struct SetupStatus {
    brew_installed: bool,
    whisper_installed: bool,
    whisper_model_present: bool,
}

fn on_path(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn default_whisper_model_path() -> String {
    format!(
        "{}/.cache/whisper/ggml-base.en.bin",
        std::env::var("HOME").unwrap_or_default()
    )
}

/// Lets the first-run setup screen show real state instead of guessing -
/// whether Homebrew and whisper.cpp are on PATH, and whether the speech
/// model has already been downloaded.
#[tauri::command]
fn check_setup_status() -> SetupStatus {
    SetupStatus {
        brew_installed: on_path("brew"),
        whisper_installed: on_path("whisper-cli"),
        whisper_model_present: std::path::Path::new(&default_whisper_model_path()).exists(),
    }
}

/// Runs `brew install whisper-cpp` for the setup screen's "Install" button.
/// This can take a while (compiling/linking a real package), so it runs on
/// a blocking thread rather than tying up the async runtime other commands
/// share.
#[tauri::command]
async fn install_whisper_cpp() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("brew")
            .args(["install", "whisper-cpp"])
            .output()
            .map_err(|e| format!("couldn't run brew: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "brew install failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| format!("install task panicked: {e}"))?
}

/// Downloads the base English whisper.cpp model into ~/.cache/whisper -
/// about 140MB, a one-time cost so speech-to-text works offline afterward.
#[tauri::command]
async fn download_whisper_model() -> Result<(), String> {
    let model_path = default_whisper_model_path();
    let dir = std::path::Path::new(&model_path)
        .parent()
        .ok_or("invalid model path")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("couldn't create {dir:?}: {e}"))?;

    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("couldn't read model bytes: {e}"))?;
    std::fs::write(&model_path, &bytes).map_err(|e| format!("couldn't write model: {e}"))?;
    Ok(())
}

/// After an in-place auto-update, macOS's Dock sometimes keeps pointing at
/// the now-replaced app bundle (the icon goes stale or stops launching the
/// new binary) because the app is ad-hoc signed rather than signed with a
/// stable Developer ID - there's no paid Apple Developer account for this
/// project, so that's not available. Forcing Launch Services to
/// re-register the bundle right before relaunching fixes it without that.
#[tauri::command]
fn refresh_launch_services() {
    let Ok(exe) = std::env::current_exe() else { return };
    // exe is .../Holdshort.app/Contents/MacOS/tauri-app
    let Some(bundle) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) else {
        return;
    };
    let _ = std::process::Command::new("touch").arg(bundle).output();
    let _ = std::process::Command::new(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    )
    .args(["-f", &bundle.to_string_lossy()])
    .output();
}

/// Transcribes a 16-bit PCM WAV recording (base64-encoded, built client-side
/// from the mic via Web Audio) using a local whisper.cpp install. There's no
/// bundled model or binary - WKWebView can't run browser speech recognition,
/// and shipping a speech model in the app would be enormous, so this shells
/// out to whatever the user has installed and says exactly what to install
/// if it isn't there yet.
#[tauri::command]
async fn transcribe_audio(wav_base64: String, model_path: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64)
        .map_err(|e| format!("couldn't decode recorded audio: {e}"))?;

    let model = model_path.unwrap_or_else(|| {
        format!(
            "{}/.cache/whisper/ggml-base.en.bin",
            std::env::var("HOME").unwrap_or_default()
        )
    });
    if !std::path::Path::new(&model).exists() {
        return Err(format!(
            "No whisper model found at {model}. Install whisper.cpp with `brew install \
             whisper-cpp`, then download a model, e.g. `curl -L -o {model} \
             https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` \
             (create the ~/.cache/whisper folder first), or set a custom model path in Settings."
        ));
    }

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let wav_path = std::env::temp_dir().join(format!("holdshort-stt-{nonce}.wav"));
    std::fs::write(&wav_path, &bytes).map_err(|e| format!("couldn't write temp audio: {e}"))?;

    let output = std::process::Command::new("whisper-cli")
        .args(["-m", &model, "-f", wav_path.to_string_lossy().as_ref(), "-nt", "-np"])
        .output();
    let _ = std::fs::remove_file(&wav_path);

    let output = output.map_err(|_| {
        "Couldn't run `whisper-cli` - install whisper.cpp with `brew install whisper-cpp` \
         and make sure it's on your PATH."
            .to_string()
    })?;
    if !output.status.success() {
        return Err(format!(
            "whisper-cli failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("heard nothing".to_string());
    }
    Ok(text)
}

fn build_snapshot(sim: &Simulation) -> SimTick {
    let aircraft = sim
        .aircraft
        .values()
        .map(|ac| AircraftSnapshot {
            callsign: ac.callsign.clone(),
            aircraft_type: ac.aircraft_type.clone(),
            state: ac.state,
            rule: ac.flight_plan.rule,
            x: ac.x,
            y: ac.y,
            heading_deg: ac.heading_deg,
            ground_speed_kt: ac.ground_speed_kt,
            destination: ac.flight_plan.destination.clone(),
            origin: ac.flight_plan.origin.clone(),
            assigned_gate: ac.flight_plan.assigned_gate.clone(),
            assigned_runway: ac.flight_plan.assigned_runway.clone(),
            is_speaking: ac.is_speaking,
        })
        .collect();
    SimTick {
        clock_s: sim.clock_s,
        aircraft,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir resolves on every supported platform");

            let default_airport =
                airports::load(&data_dir, "KBUR").expect("bundled KBUR surface data loads");
            let sim = Simulation::new(default_airport);
            let traffic = TrafficGenerator::new(45.0);
            app.manage(AppState {
                sim: Mutex::new(sim),
                traffic: Mutex::new(traffic),
                active: Mutex::new(false),
                runway: Mutex::new(ActiveRunway {
                    rwy_ref: "15/33".to_string(),
                    departure_end: "15".to_string(),
                }),
                data_dir,
            });

            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Physics advances at 4 Hz for accurate taxi/hold-short
                // timing, but the display only gets a fresh snapshot once a
                // second - real surface radar updates at roughly 1 Hz, not
                // smooth continuous motion, so this keeps the on-screen feel
                // honest instead of silky-interpolated.
                let dt = 0.25;
                let mut ticks_since_emit = 0u32;
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    let state = app_handle.state::<AppState>();
                    if !*state.active.lock().unwrap() {
                        continue;
                    }
                    let mut sim = state.sim.lock().unwrap();
                    let mut traffic = state.traffic.lock().unwrap();
                    let rwy = state.runway.lock().unwrap();
                    traffic.tick(dt, &mut sim, &rwy.rwy_ref, &rwy.departure_end);
                    drop(rwy);
                    sim.tick(dt);
                    drop(traffic);

                    ticks_since_emit += 1;
                    if ticks_since_emit < 4 {
                        drop(sim);
                        continue;
                    }
                    ticks_since_emit = 0;
                    let snapshot = build_snapshot(&sim);
                    drop(sim);
                    let _ = app_handle.emit("sim-tick", snapshot);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_installed,
            list_catalog,
            is_installed,
            install_airport,
            uninstall_airport,
            start_session,
            end_session,
            get_airport,
            get_traffic,
            issue_clearance,
            set_speaking,
            get_metar,
            ask_ai,
            transcribe_audio,
            check_setup_status,
            install_whisper_cpp,
            download_whisper_model,
            refresh_launch_services
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
