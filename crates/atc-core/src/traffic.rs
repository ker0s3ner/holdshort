use crate::sim::Simulation;
use rand::seq::SliceRandom;
use rand::Rng;

const AIRLINES: &[(&str, &str)] = &[
    ("SKW", "Skywest"),
    ("AAL", "American"),
    ("UAL", "United"),
    ("JBU", "JetBlue"),
    ("SWA", "Southwest"),
    ("SCX", "SunCountry"),
];

const AIRCRAFT_TYPES: &[&str] = &["A320", "B738", "E175", "CRJ9", "A319", "B739"];

const DESTINATIONS: &[&str] = &[
    "KLAX", "KSFO", "KPHX", "KDEN", "KSEA", "KSAN", "KOAK", "KLAS",
];

/// Procedurally generates a plausible traffic sample: picks a random free
/// gate, airline/type/destination combination, and runway end, then spawns
/// a departure on the simulation. This stands in for a full schedule-driven
/// generator and can be swapped out without touching the sim engine.
pub struct TrafficGenerator {
    pub next_spawn_in_s: f64,
    pub spawn_interval_s: f64,
    used_gates: Vec<String>,
}

impl TrafficGenerator {
    pub fn new(spawn_interval_s: f64) -> Self {
        TrafficGenerator {
            next_spawn_in_s: spawn_interval_s,
            spawn_interval_s,
            used_gates: Vec::new(),
        }
    }

    pub fn tick(&mut self, dt_s: f64, sim: &mut Simulation, runway_ref: &str, departure_end: &str) {
        self.next_spawn_in_s -= dt_s;
        if self.next_spawn_in_s > 0.0 {
            return;
        }
        self.next_spawn_in_s = self.spawn_interval_s;

        let mut rng = rand::thread_rng();
        let free_gates: Vec<String> = sim
            .airport
            .parking_positions
            .iter()
            .map(|p| p.ref_.clone())
            .filter(|g| !self.used_gates.contains(g) && !g.is_empty())
            .collect();
        let Some(gate) = free_gates.choose(&mut rng) else {
            return;
        };

        let (airline, _name) = AIRLINES.choose(&mut rng).unwrap();
        let flight_no: u32 = rng.gen_range(100..9999);
        let callsign = format!("{airline}{flight_no}");
        let ac_type = AIRCRAFT_TYPES.choose(&mut rng).unwrap();
        let dest = DESTINATIONS.choose(&mut rng).unwrap();

        match sim.spawn_departure(&callsign, ac_type, gate, runway_ref, departure_end) {
            Ok(()) => {
                if let Some(ac) = sim.aircraft.get_mut(&callsign) {
                    ac.flight_plan.destination = dest.to_string();
                }
                self.used_gates.push(gate.clone());
            }
            Err(_) => {}
        }
    }

    pub fn release_gate(&mut self, gate_ref: &str) {
        self.used_gates.retain(|g| g != gate_ref);
    }
}
