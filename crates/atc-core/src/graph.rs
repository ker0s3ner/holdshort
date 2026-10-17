use crate::model::{AirportData, Node};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

#[derive(Debug, Clone)]
pub struct AdjEdge {
    pub to: String,
    pub edge_id: String,
    pub kind: String,
    pub ref_: String,
    pub length_m: f64,
}

/// Routable graph of the airport's movement area: taxiways, taxilanes,
/// runways (crossable), and gate links, built from real-world OSM geometry.
pub struct TaxiGraph {
    pub nodes: HashMap<String, Node>,
    pub adjacency: HashMap<String, Vec<AdjEdge>>,
}

impl TaxiGraph {
    pub fn build(airport: &AirportData) -> Self {
        let mut nodes = HashMap::new();
        for n in &airport.nodes {
            nodes.insert(n.id.clone(), n.clone());
        }

        let mut adjacency: HashMap<String, Vec<AdjEdge>> = HashMap::new();
        for e in &airport.edges {
            adjacency
                .entry(e.from.clone())
                .or_default()
                .push(AdjEdge {
                    to: e.to.clone(),
                    edge_id: e.id.clone(),
                    kind: e.kind.clone(),
                    ref_: e.ref_.clone(),
                    length_m: e.length_m,
                });
            // Taxiway/ramp geometry is routable in both directions.
            adjacency
                .entry(e.to.clone())
                .or_default()
                .push(AdjEdge {
                    to: e.from.clone(),
                    edge_id: e.id.clone(),
                    kind: e.kind.clone(),
                    ref_: e.ref_.clone(),
                    length_m: e.length_m,
                });
        }

        TaxiGraph { nodes, adjacency }
    }

    /// The `kind` of the edge directly connecting `a` to `b`, if adjacent.
    pub fn edge_kind(&self, a: &str, b: &str) -> Option<&str> {
        self.adjacency
            .get(a)?
            .iter()
            .find(|e| e.to == b)
            .map(|e| e.kind.as_str())
    }

    fn heuristic(&self, a: &str, b: &str) -> f64 {
        match (self.nodes.get(a), self.nodes.get(b)) {
            (Some(na), Some(nb)) => ((na.x - nb.x).powi(2) + (na.y - nb.y).powi(2)).sqrt(),
            _ => 0.0,
        }
    }

    /// A* shortest path by ground distance across the full movement-area
    /// graph (taxiways, taxilanes, crossable runways, gate links).
    pub fn find_path(&self, start: &str, goal: &str) -> Option<Vec<String>> {
        if !self.nodes.contains_key(start) || !self.nodes.contains_key(goal) {
            return None;
        }
        if start == goal {
            return Some(vec![start.to_string()]);
        }

        let mut open = BinaryHeap::new();
        let mut g_score: HashMap<String, f64> = HashMap::new();
        let mut came_from: HashMap<String, String> = HashMap::new();

        g_score.insert(start.to_string(), 0.0);
        open.push(QueueItem {
            node: start.to_string(),
            f_score: self.heuristic(start, goal),
        });

        while let Some(QueueItem { node, .. }) = open.pop() {
            if node == goal {
                return Some(reconstruct_path(&came_from, &node));
            }
            let current_g = *g_score.get(&node).unwrap_or(&f64::INFINITY);
            if let Some(neighbors) = self.adjacency.get(&node) {
                for edge in neighbors {
                    let tentative_g = current_g + edge.length_m;
                    let best_known = *g_score.get(&edge.to).unwrap_or(&f64::INFINITY);
                    if tentative_g < best_known {
                        came_from.insert(edge.to.clone(), node.clone());
                        g_score.insert(edge.to.clone(), tentative_g);
                        open.push(QueueItem {
                            node: edge.to.clone(),
                            f_score: tentative_g + self.heuristic(&edge.to, goal),
                        });
                    }
                }
            }
        }
        None
    }

    /// Routes a just-touched-down arrival from its landing threshold to a
    /// gate without ever turning back toward the threshold it came from.
    /// Plain `find_path` treats the whole surface graph as symmetric, which
    /// let a fresh arrival's shortest path double back along the runway -
    /// a physically impossible mid-rollout 180. This walks forward along
    /// the runway/stopway strip (toward `far_end`) until it reaches the
    /// first taxiway/taxilane junction - a real exit - then hands off to
    /// normal routing from there. If the runway has no exit mapped before
    /// `far_end`, it rolls all the way to the far threshold instead.
    /// Returns the full rollout-to-gate route plus the route index of the
    /// node where the aircraft actually clears the runway - the point
    /// LandingRollout should stop at and wait for an explicit taxi
    /// clearance, rather than rolling the real exit distance and then
    /// continuing on to the gate unprompted.
    pub fn find_arrival_path(&self, threshold: &str, far_end: &str, gate: &str) -> Option<(Vec<String>, usize)> {
        let mut rollout = vec![threshold.to_string()];
        let mut current = threshold.to_string();
        let mut prev: Option<String> = None;

        while current != far_end {
            let neighbors = self.adjacency.get(&current)?;
            let has_exit = neighbors.iter().any(|e| {
                (e.kind == "taxiway" || e.kind == "taxilane")
                    && prev.as_deref() != Some(e.to.as_str())
            });
            if has_exit {
                break;
            }
            let forward = neighbors.iter().find(|e| {
                (e.kind == "runway" || e.kind == "stopway")
                    && prev.as_deref() != Some(e.to.as_str())
            });
            match forward {
                Some(edge) => {
                    prev = Some(current.clone());
                    current = edge.to.clone();
                    rollout.push(current.clone());
                }
                None => break,
            }
        }

        let exit_index = rollout.len() - 1;
        let rest = self.find_path(&current, gate)?;
        rollout.pop(); // `current` is the first node of `rest` too.
        rollout.extend(rest);
        Some((rollout, exit_index))
    }

}

fn reconstruct_path(came_from: &HashMap<String, String>, goal: &str) -> Vec<String> {
    let mut path = vec![goal.to_string()];
    let mut current = goal;
    while let Some(prev) = came_from.get(current) {
        path.push(prev.clone());
        current = prev;
    }
    path.reverse();
    path
}

struct QueueItem {
    node: String,
    f_score: f64,
}

impl Eq for QueueItem {}
impl PartialEq for QueueItem {
    fn eq(&self, other: &Self) -> bool {
        self.f_score == other.f_score
    }
}
impl Ord for QueueItem {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reversed for a min-heap via BinaryHeap (which is a max-heap).
        other
            .f_score
            .partial_cmp(&self.f_score)
            .unwrap_or(Ordering::Equal)
    }
}
impl PartialOrd for QueueItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
