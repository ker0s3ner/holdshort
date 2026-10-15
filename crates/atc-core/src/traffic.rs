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

const OTHER_AIRPORTS: &[&str] = &["KLAX", "KSFO", "KPHX", "KDEN", "KSEA", "KSAN", "KOAK", "KLAS"];

/// Procedurally generates a plausible mix of departure and arrival traffic:
/// picks a random free gate, airline/type/other-airport combination, and
/// spawns either a departure or an arrival on the simulation. Gate
/// occupancy is derived live from the simulation's current aircraft each
/// time (rather than tracked separately), so a gate frees up automatically
/// the moment its aircraft departs or a parked arrival despawns - no manual
/// release bookkeeping to get out of sync.
pub struct TrafficGenerator {
    pub next_spawn_in_s: f64,
    pub spawn_interval_s: f64,
}

impl TrafficGenerator {
    pub fn new(spawn_interval_s: f64) -> Self {
        TrafficGenerator {
            next_spawn_in_s: spawn_interval_s,
            spawn_interval_s,
        }
    }

    pub fn tick(&mut self, dt_s: f64, sim: &mut Simulation, runway_ref: &str, departure_end: &str) {
        self.next_spawn_in_s -= dt_s;
        if self.next_spawn_in_s > 0.0 {
            return;
        }
        self.next_spawn_in_s = self.spawn_interval_s;

        let mut rng = rand::thread_rng();
        let occupied: Vec<String> = sim
            .aircraft
            .values()
            .map(|a| a.flight_plan.assigned_gate.clone())
            .collect();
        let free_gates: Vec<String> = sim
            .airport
            .parking_positions
            .iter()
            .map(|p| p.ref_.clone())
            .filter(|g| !g.is_empty() && !occupied.contains(g))
            .collect();
        let Some(gate) = free_gates.choose(&mut rng) else {
            return;
        };

        let (airline, _name) = AIRLINES.choose(&mut rng).unwrap();
        let flight_no: u32 = rng.gen_range(100..9999);
        let callsign = format!("{airline}{flight_no}");
        let ac_type = AIRCRAFT_TYPES.choose(&mut rng).unwrap();
        let other_airport = OTHER_AIRPORTS.choose(&mut rng).unwrap();

        let is_arrival = rng.gen_bool(0.5);
        if is_arrival {
            if let Ok(()) =
                sim.spawn_arrival(&callsign, ac_type, runway_ref, departure_end, gate)
            {
                if let Some(ac) = sim.aircraft.get_mut(&callsign) {
                    ac.flight_plan.origin = other_airport.to_string();
                }
            }
        } else if let Ok(()) =
            sim.spawn_departure(&callsign, ac_type, gate, runway_ref, departure_end)
        {
            if let Some(ac) = sim.aircraft.get_mut(&callsign) {
                ac.flight_plan.destination = other_airport.to_string();
            }
        }
    }
}
