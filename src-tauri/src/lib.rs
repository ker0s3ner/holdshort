use atc_core::airports::AirportSummary;
use atc_core::clearance::ClearanceCommand;
use atc_core::{
    airports, AircraftState, AirportData, ControllerRole, FlightRule, Simulation, TrafficGenerator,
};
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
    role: Mutex<ControllerRole>,
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
fn start_session(
    state: tauri::State<AppState>,
    icao: String,
    role: ControllerRole,
) -> Result<(), String> {
    let airport = airports::load(&state.data_dir, &icao)?;
    let (rwy_ref, departure_end) = airport
        .runways
        .first()
        .and_then(|r| r.ends.first().map(|e| (r.ref_.clone(), e.clone())))
        .ok_or_else(|| format!("{icao} has no runways defined"))?;

    // Busier (more gates) airports see more frequent traffic, like real
    // operations - a 27-gate field like Kaunas stays quiet, a 300+ gate hub
    // like Heathrow or Frankfurt spawns much more often. But this sim only
    // models one active runway at a time (a real hub splits load across
    // several in parallel), so the floor has to reflect what a single
    // runway can actually turn around - about one operation every 40+
    // seconds - rather than how many gates a huge airport has. The traffic
    // generator also refuses to spawn onto an occupied runway outright, so
    // this floor is a pacing choice, not the only thing preventing stacking.
    let gate_count = airport.parking_positions.len().max(1) as f64;
    let spawn_interval_s = (2200.0 / gate_count).clamp(40.0, 150.0);

    *state.sim.lock().unwrap() = Simulation::new(airport);
    *state.traffic.lock().unwrap() = TrafficGenerator::new(spawn_interval_s, &icao);
    *state.runway.lock().unwrap() = ActiveRunway {
        rwy_ref,
        departure_end,
    };
    *state.role.lock().unwrap() = role;
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

/// Switches which runway new departures/arrivals are assigned to - real
/// airports change their active runway with the wind, this was hardcoded
/// to the airport data's first runway and never changeable at runtime.
/// Traffic already in the air/on the ground on the old runway keeps going;
/// this only affects what gets assigned next.
#[tauri::command]
fn set_active_runway(state: tauri::State<AppState>, rwy_ref: String, departure_end: String) -> Result<(), String> {
    let sim = state.sim.lock().unwrap();
    let rw = sim
        .airport
        .runways
        .iter()
        .find(|r| r.ref_ == rwy_ref)
        .ok_or_else(|| format!("unknown runway {rwy_ref}"))?;
    if !rw.ends.iter().any(|e| e == &departure_end) {
        return Err(format!("{rwy_ref} has no end {departure_end}"));
    }
    drop(sim);
    *state.runway.lock().unwrap() = ActiveRunway {
        rwy_ref,
        departure_end,
    };
    Ok(())
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
    ollama_installed: bool,
    ollama_model_present: bool,
}

/// A GUI-launched app (double-clicked from Finder or the Dock, which is how
/// the packaged .app actually runs) gets macOS's bare default PATH -
/// `/usr/bin:/bin:/usr/sbin:/sbin` - not the user's shell PATH from
/// .zshrc, so Homebrew's own bin directory is invisible even though `which
/// brew` finds it fine in a Terminal. Check Homebrew's two standard install
/// locations directly before falling back to a PATH-based `which`, which is
/// what actually works when this runs from `cargo tauri dev` in a terminal.
fn find_executable(name: &str) -> Option<String> {
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let path = format!("{dir}/{name}");
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    std::process::Command::new("which")
        .arg(name)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

const DEFAULT_WHISPER_MODEL: &str = "small.en";

/// Maps a ladder entry (tiny.en/base.en/small.en/medium.en/large-v3) to
/// its cached file path - every whisper.cpp ggml model follows this exact
/// naming convention on Hugging Face, so this is also how the download
/// URL is built.
fn whisper_model_path(model: &str) -> String {
    format!(
        "{}/.cache/whisper/ggml-{model}.bin",
        std::env::var("HOME").unwrap_or_default()
    )
}

/// Best-effort check for whether an Ollama model has been pulled, by
/// asking its local API rather than shelling out to `ollama list` (which
/// needs the daemon reachable anyway, so the HTTP call tells us the same
/// thing and doubles as a liveness check).
async fn ollama_has_model(model: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct Tags {
        models: Vec<TagModel>,
    }
    #[derive(serde::Deserialize)]
    struct TagModel {
        name: String,
    }
    let Ok(resp) = reqwest::get("http://localhost:11434/api/tags").await else {
        return false;
    };
    let Ok(tags) = resp.json::<Tags>().await else {
        return false;
    };
    tags.models.iter().any(|m| m.name.starts_with(model))
}

/// Lets the first-run setup screen show real state instead of guessing -
/// whether Homebrew, whisper.cpp and Ollama are actually installed, and
/// whether the specific speech/AI models the user picked have actually
/// been downloaded.
#[tauri::command]
async fn check_setup_status(ollama_model: String, whisper_model: String) -> SetupStatus {
    SetupStatus {
        brew_installed: find_executable("brew").is_some(),
        whisper_installed: find_executable("whisper-cli").is_some(),
        whisper_model_present: std::path::Path::new(&whisper_model_path(&whisper_model)).exists(),
        ollama_installed: find_executable("ollama").is_some(),
        ollama_model_present: ollama_has_model(&ollama_model).await,
    }
}

fn run_brew(args: &[&str]) -> Result<String, String> {
    let brew = find_executable("brew").ok_or_else(|| {
        "Homebrew isn't installed - install it from https://brew.sh first.".to_string()
    })?;
    let output = std::process::Command::new(brew)
        .args(args)
        .output()
        .map_err(|e| format!("couldn't run brew: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Runs `brew install whisper-cpp` for the setup screen's "Install" button.
/// This can take a while (compiling/linking a real package), so it runs on
/// a blocking thread rather than tying up the async runtime other commands
/// share.
#[tauri::command]
async fn install_whisper_cpp() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| run_brew(&["install", "whisper-cpp"]))
        .await
        .map_err(|e| format!("install task panicked: {e}"))?
}

/// Runs `brew install ollama` then starts it as a background service (so
/// `ollama pull`/`ollama run` have a daemon to talk to without the user
/// needing to leave a terminal window open).
#[tauri::command]
async fn install_ollama() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = run_brew(&["install", "ollama"])?;
        let _ = run_brew(&["services", "start", "ollama"]);
        Ok(out)
    })
    .await
    .map_err(|e| format!("install task panicked: {e}"))?
}

#[derive(Serialize, Clone)]
struct PullProgress {
    status: String,
    percent: Option<f64>,
}

/// Pulls an Ollama model via its local streaming HTTP API rather than
/// shelling out to `ollama pull` and parsing its carriage-return-animated
/// terminal progress bar - the API streams newline-delimited JSON with
/// exact byte counts, which is both simpler and more reliable to turn
/// into a real percentage for the UI.
#[tauri::command]
async fn pull_ollama_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut resp = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|_| {
            "Couldn't reach Ollama at localhost:11434 - make sure it's installed and running."
                .to_string()
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama pull failed ({status}): {text}"));
    }

    let mut buf = String::new();
    let mut last_error: Option<String> = None;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("pull stream error: {e}"))?
    {
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim().to_string();
            buf.drain(..=idx);
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                last_error = Some(err.to_string());
                continue;
            }
            let status = v
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let percent = match (
                v.get("completed").and_then(|c| c.as_f64()),
                v.get("total").and_then(|t| t.as_f64()),
            ) {
                (Some(completed), Some(total)) if total > 0.0 => Some(completed / total * 100.0),
                _ => None,
            };
            let _ = app.emit("ollama-pull-progress", PullProgress { status, percent });
        }
    }
    if let Some(err) = last_error {
        return Err(format!("Ollama pull failed: {err}"));
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    percent: f64,
}

/// Downloads a whisper.cpp ggml model into ~/.cache/whisper, streaming it
/// in chunks (rather than one `.bytes()` call that only resolves once the
/// whole multi-hundred-MB file is in memory) so real download progress -
/// not just a static "Downloading…" - can be emitted to the UI.
#[tauri::command]
async fn download_whisper_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    let model_path = whisper_model_path(&model);
    let dir = std::path::Path::new(&model_path)
        .parent()
        .ok_or("invalid model path")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("couldn't create {dir:?}: {e}"))?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin"
    );
    let mut resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let tmp_path = format!("{model_path}.part");
    let mut file = std::fs::File::create(&tmp_path).map_err(|e| format!("couldn't create {tmp_path}: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut last_emitted = -1i64;
    use std::io::Write;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("download stream error: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| format!("couldn't write model: {e}"))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let percent = (downloaded as f64 / total as f64 * 100.0).min(100.0);
            let rounded = percent as i64;
            if rounded != last_emitted {
                last_emitted = rounded;
                let _ = app.emit("whisper-download-progress", DownloadProgress { percent });
            }
        }
    }
    drop(file);
    std::fs::rename(&tmp_path, &model_path).map_err(|e| format!("couldn't finalize model file: {e}"))?;
    let _ = app.emit("whisper-download-progress", DownloadProgress { percent: 100.0 });
    Ok(())
}

/// Wipes any cached TCC decision for this app's mic access and re-adds it
/// to the request list that `open_microphone_settings` opens. Ad-hoc
/// signed builds (no paid Apple Developer account for this project) get a
/// different code signature every single build, and macOS's TCC daemon
/// keys permission decisions to that signature - so an app that asked for
/// the mic before a rebuild can end up with a stuck, invisible denial that
/// never shows in the Microphone list at all and silently rejects every
/// future request. `tccutil reset` clears that stuck state so the very
/// next getUserMedia() call prompts fresh, like a first launch - but only
/// after the app is fully quit and reopened, since the already-running
/// process has its own in-memory copy of the old decision.
#[tauri::command]
fn reset_microphone_permission(app: tauri::AppHandle) -> Result<(), String> {
    let identifier = app.config().identifier.clone();
    let output = std::process::Command::new("tccutil")
        .args(["reset", "Microphone", &identifier])
        .output()
        .map_err(|e| format!("couldn't run tccutil: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

/// Opens System Settings straight to the Microphone privacy pane. Once the
/// user has denied the mic prompt (or it never fired), there's no API to
/// re-ask from inside the app - macOS only lets the user flip it back on
/// in System Settings, so the best this app can do is take them straight
/// there instead of making them hunt for it.
#[tauri::command]
fn open_microphone_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        .output();
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
async fn transcribe_audio(
    wav_base64: String,
    model_path: Option<String>,
    whisper_model: Option<String>,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64)
        .map_err(|e| format!("couldn't decode recorded audio: {e}"))?;

    // `model_path` is the power-user override (an exact file path);
    // otherwise resolve from the ladder entry the user picked in Settings,
    // falling back to the recommended default if neither was set.
    let model = model_path.unwrap_or_else(|| {
        whisper_model_path(whisper_model.as_deref().unwrap_or(DEFAULT_WHISPER_MODEL))
    });
    if !std::path::Path::new(&model).exists() {
        return Err(format!(
            "No whisper model found at {model}. Install whisper.cpp with `brew install \
             whisper-cpp`, then download a model from Settings → Voice, or `curl -L -o {model} \
             https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin` \
             (create the ~/.cache/whisper folder first)."
        ));
    }

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let wav_path = std::env::temp_dir().join(format!("holdshort-stt-{nonce}.wav"));
    std::fs::write(&wav_path, &bytes).map_err(|e| format!("couldn't write temp audio: {e}"))?;

    let Some(whisper_cli) = find_executable("whisper-cli") else {
        let _ = std::fs::remove_file(&wav_path);
        return Err(
            "Couldn't find `whisper-cli` - install whisper.cpp with `brew install whisper-cpp`."
                .to_string(),
        );
    };
    // Whisper's "initial prompt" biases its decoding toward whatever
    // vocabulary and style the prompt is written in - a well-known trick
    // for domain-specific speech it was never fine-tuned on. Short ATC
    // phrases ("pushback", "taxi", "hold short"...) aren't common in its
    // training data and were getting misheard as unrelated words entirely
    // without this. -l en also stops it from occasionally guessing the
    // wrong language on a short, noisy clip and transcribing garbage.
    const ATC_PROMPT: &str = "Air traffic control radio phraseology. Pushback approved. \
         Taxi to runway via taxiway alpha, bravo, charlie. Hold short. Line up and wait. \
         Cleared for takeoff. Cleared to land. Go around. Cancel clearance. Request taxi \
         to gate. Ready for departure. Runway vacated. Standby. Roger. Wilco. Heavy. Super.";
    let output = std::process::Command::new(whisper_cli)
        .args([
            "-m",
            &model,
            "-f",
            wav_path.to_string_lossy().as_ref(),
            "-l",
            "en",
            "--prompt",
            ATC_PROMPT,
            "-nt",
            "-np",
        ])
        .output();
    let _ = std::fs::remove_file(&wav_path);

    let output = output.map_err(|e| format!("couldn't run whisper-cli: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "whisper-cli failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() || is_whisper_hallucination(&text) {
        return Err("heard nothing".to_string());
    }
    Ok(text)
}

/// whisper.cpp is trained partly on captioned video, so on silence or pure
/// background noise it doesn't reliably output nothing - it tends to
/// confabulate one of a small set of stock captioning phrases instead
/// (e.g. "Thanks for watching!", "Subscribe to my channel", "Closed
/// captioning by..."). None of those are real ATC phraseology, so treat
/// them the same as empty output rather than showing the user a bogus
/// "heard" transcript and a confusing "didn't recognize a clearance" error.
fn is_whisper_hallucination(text: &str) -> bool {
    let lower = text.to_lowercase();
    const PATTERNS: &[&str] = &[
        "thanks for watching",
        "thank you for watching",
        "please subscribe",
        "subscribe to",
        "like and subscribe",
        "closed captioning",
        "captioned by",
        "transcribed by",
        "subtitles by",
        "amara.org",
        "[blank_audio]",
        "[silence]",
        "(silence)",
        "you're welcome",
    ];
    PATTERNS.iter().any(|p| lower.contains(p))
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
            let traffic = TrafficGenerator::new(45.0, "KBUR");
            app.manage(AppState {
                sim: Mutex::new(sim),
                traffic: Mutex::new(traffic),
                active: Mutex::new(false),
                runway: Mutex::new(ActiveRunway {
                    rwy_ref: "15/33".to_string(),
                    departure_end: "15".to_string(),
                }),
                role: Mutex::new(ControllerRole::Ground),
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
                    let spawn_event = traffic.tick(dt, &mut sim, &rwy.rwy_ref, &rwy.departure_end);
                    drop(rwy);
                    let mut pilot_events = sim.tick(dt);
                    sim.apply_automation(*state.role.lock().unwrap());
                    drop(traffic);
                    pilot_events.extend(spawn_event);
                    // Pilots calling in unprompted shouldn't wait for the
                    // once-a-second display snapshot - send these the
                    // moment they happen so the radio stays responsive.
                    if !pilot_events.is_empty() {
                        let _ = app_handle.emit("sim-event", pilot_events);
                    }

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
            install_ollama,
            pull_ollama_model,
            refresh_launch_services,
            open_microphone_settings,
            reset_microphone_permission,
            set_active_runway
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
