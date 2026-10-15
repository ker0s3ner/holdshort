use crate::aircraft::AircraftState;
use crate::sim::{SimEvent, Simulation};
use rand::seq::{IteratorRandom, SliceRandom};
use rand::Rng;

/// (ICAO airline code, telephony/brand name spoken on the radio)
pub type Airline = (&'static str, &'static str);

const US_AIRLINES: &[Airline] = &[
    ("AAL", "American"),
    ("UAL", "United"),
    ("DAL", "Delta"),
    ("SWA", "Southwest"),
    ("JBU", "JetBlue"),
    ("ASA", "Alaska"),
    ("FFT", "Frontier"),
    ("SKW", "SkyWest"),
];

const EUROPE_AIRLINES: &[Airline] = &[
    ("RYR", "Ryanair"),
    ("EZY", "EasyJet"),
    ("BAW", "Speedbird"),
    ("DLH", "Lufthansa"),
    ("AFR", "Airfrance"),
    ("KLM", "KLM"),
    ("SAS", "Scandinavian"),
    ("FIN", "Finnair"),
    ("WZZ", "Wizzair"),
    ("NAX", "Norwegian"),
    ("EIN", "Shamrock"),
    ("VLG", "Vueling"),
];

const TURKEY_AIRLINES: &[Airline] = &[("THY", "Turkish"), ("PGT", "Sunturk")];

const UAE_AIRLINES: &[Airline] = &[
    ("UAE", "Emirates"),
    ("ETD", "Etihad"),
    ("FDB", "Flydubai"),
];

const JAPAN_AIRLINES: &[Airline] = &[("ANA", "Allnippon"), ("JAL", "Japanair"), ("SKY", "Skymark")];

const US_AIRPORTS: &[&str] = &["KLAX", "KSFO", "KPHX", "KDEN", "KSEA", "KSAN", "KOAK", "KLAS", "KJFK", "KORD", "KATL", "KDFW"];
const EUROPE_AIRPORTS: &[&str] = &[
    "EGLL", "EGKK", "EGCC", "EDDF", "ENGM", "ESSA", "EFHK", "EKCH", "EETN", "EVRA", "EYVI", "EIDW",
];
const TURKEY_AIRPORTS: &[&str] = &["LTFM", "EGLL", "EDDF", "OMDB"];
const UAE_AIRPORTS: &[&str] = &["OMDB", "LTFM", "EGLL", "EDDF"];
const JAPAN_AIRPORTS: &[&str] = &["RJTT", "RJAA", "RJBB", "RJCC"];

const AIRCRAFT_TYPES: &[&str] = &["A320", "B738", "E175", "CRJ9", "A319", "B739"];

/// Real airlines fly where their network actually goes - American doesn't
/// serve Kaunas and Ryanair doesn't serve JFK - so the airline (and the
/// plausible other end of the flight) is picked from a region-appropriate
/// pool keyed off the controlled airport's own ICAO prefix, not a single
/// global list.
fn region_pools(icao: &str) -> (&'static [Airline], &'static [&'static str]) {
    let icao = icao.to_uppercase();
    if icao.starts_with("LT") {
        (TURKEY_AIRLINES, TURKEY_AIRPORTS)
    } else if icao.starts_with("OM") {
        (UAE_AIRLINES, UAE_AIRPORTS)
    } else if icao.starts_with('R') {
        (JAPAN_AIRLINES, JAPAN_AIRPORTS)
    } else if icao.starts_with('K') || icao.starts_with('C') {
        (US_AIRLINES, US_AIRPORTS)
    } else if icao.starts_with('E') || icao.starts_with('L') {
        (EUROPE_AIRLINES, EUROPE_AIRPORTS)
    } else {
        (US_AIRLINES, US_AIRPORTS)
    }
}

/// Procedurally generates a plausible mix of departure and arrival traffic:
/// picks a random free gate, airline/type/other-airport combination from
/// this airport's region, and spawns either a departure or an arrival on
/// the simulation. Gate occupancy is derived live from the simulation's
/// current aircraft each time (rather than tracked separately), so a gate
/// frees up automatically the moment its aircraft departs or a parked
/// arrival despawns - no manual release bookkeeping to get out of sync.
pub struct TrafficGenerator {
    pub next_spawn_in_s: f64,
    pub spawn_interval_s: f64,
    airlines: &'static [Airline],
    other_airports: &'static [&'static str],
}

impl TrafficGenerator {
    pub fn new(spawn_interval_s: f64, airport_icao: &str) -> Self {
        let (airlines, other_airports) = region_pools(airport_icao);
        TrafficGenerator {
            next_spawn_in_s: spawn_interval_s,
            spawn_interval_s,
            airlines,
            other_airports,
        }
    }

    pub fn tick(
        &mut self,
        dt_s: f64,
        sim: &mut Simulation,
        runway_ref: &str,
        departure_end: &str,
    ) -> Option<SimEvent> {
        self.next_spawn_in_s -= dt_s;
        if self.next_spawn_in_s > 0.0 {
            return None;
        }
        self.next_spawn_in_s = self.spawn_interval_s;

        // There's only one active runway in this sim (real hubs spread
        // load across several in parallel, which this doesn't model), so
        // never spawn a new arrival or departure onto it while another
        // aircraft is already using it - that's how two aircraft end up
        // occupying the same runway at once.
        let runway_occupied = sim.aircraft.values().any(|a| {
            a.flight_plan.assigned_runway == runway_ref
                && matches!(
                    a.state,
                    AircraftState::TakeoffRoll
                        | AircraftState::LinedUp
                        | AircraftState::LandingRollout
                )
        });
        if runway_occupied {
            return None;
        }

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
            return None;
        };

        let (airline, _name) = self.airlines.choose(&mut rng).unwrap();
        let flight_no: u32 = rng.gen_range(100..9999);
        let callsign = format!("{airline}{flight_no}");
        let ac_type = AIRCRAFT_TYPES.choose(&mut rng).unwrap();
        let other_airport = self
            .other_airports
            .iter()
            .filter(|a| *a != &sim.airport.icao)
            .choose(&mut rng)
            .unwrap_or(&self.other_airports[0]);

        let is_arrival = rng.gen_bool(0.5);
        if is_arrival {
            if let Ok(()) =
                sim.spawn_arrival(&callsign, ac_type, runway_ref, departure_end, gate)
            {
                if let Some(ac) = sim.aircraft.get_mut(&callsign) {
                    ac.flight_plan.origin = other_airport.to_string();
                }
            }
            None
        } else if let Ok(()) =
            sim.spawn_departure(&callsign, ac_type, gate, runway_ref, departure_end)
        {
            if let Some(ac) = sim.aircraft.get_mut(&callsign) {
                ac.flight_plan.destination = other_airport.to_string();
            }
            Some(SimEvent {
                callsign,
                message: format!("at gate {gate}, request pushback"),
            })
        } else {
            None
        }
    }
}
