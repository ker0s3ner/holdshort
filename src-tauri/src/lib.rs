use atc_core::airports::AirportSummary;
use atc_core::clearance::ClearanceCommand;
use atc_core::{airports, AircraftState, AirportData, Simulation, TrafficGenerator};
use serde::Serialize;
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
}

#[derive(Serialize, Clone)]
struct AircraftSnapshot {
    callsign: String,
    aircraft_type: String,
    state: AircraftState,
    x: f64,
    y: f64,
    heading_deg: f64,
    ground_speed_kt: f64,
    destination: String,
    assigned_gate: String,
    assigned_runway: String,
}

#[derive(Serialize, Clone)]
struct SimTick {
    clock_s: f64,
    aircraft: Vec<AircraftSnapshot>,
}

#[tauri::command]
fn list_airports() -> Vec<AirportSummary> {
    airports::available_airports()
}

#[tauri::command]
fn start_session(state: tauri::State<AppState>, icao: String) -> Result<(), String> {
    let airport = airports::load(&icao)?;
    let (rwy_ref, departure_end) = airport
        .runways
        .first()
        .and_then(|r| r.ends.first().map(|e| (r.ref_.clone(), e.clone())))
        .ok_or_else(|| format!("{icao} has no runways defined"))?;

    *state.sim.lock().unwrap() = Simulation::new(airport);
    *state.traffic.lock().unwrap() = TrafficGenerator::new(45.0);
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

fn build_snapshot(sim: &Simulation) -> SimTick {
    let aircraft = sim
        .aircraft
        .values()
        .map(|ac| AircraftSnapshot {
            callsign: ac.callsign.clone(),
            aircraft_type: ac.aircraft_type.clone(),
            state: ac.state,
            x: ac.x,
            y: ac.y,
            heading_deg: ac.heading_deg,
            ground_speed_kt: ac.ground_speed_kt,
            destination: ac.flight_plan.destination.clone(),
            assigned_gate: ac.flight_plan.assigned_gate.clone(),
            assigned_runway: ac.flight_plan.assigned_runway.clone(),
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
            let default_airport = airports::load("KBUR").expect("bundled KBUR surface data loads");
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
            });

            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let dt = 0.25;
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
                    let snapshot = build_snapshot(&sim);
                    drop(traffic);
                    drop(sim);
                    let _ = app_handle.emit("sim-tick", snapshot);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_airports,
            start_session,
            end_session,
            get_airport,
            get_traffic,
            issue_clearance
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
