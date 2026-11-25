use crate::aircraft::ControllerRole;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub recommended_role: ControllerRole,
    pub spawn_interval_s: f64,
    pub arrival_spacing_nm: f64,
    pub strict_safety: bool,
}

pub fn builtins() -> Vec<ScenarioDefinition> {
    vec![
        ScenarioDefinition {
            id: "free-play".into(),
            name: "Free play".into(),
            description: "Procedural traffic with standard safety enforcement.".into(),
            recommended_role: ControllerRole::Ground,
            spawn_interval_s: 90.0,
            arrival_spacing_nm: 8.0,
            strict_safety: true,
        },
        ScenarioDefinition {
            id: "tower-runway-surge".into(),
            name: "Tower runway surge".into(),
            description: "A busier tower session focused on runway sequencing and departures.".into(),
            recommended_role: ControllerRole::Tower,
            spawn_interval_s: 42.0,
            arrival_spacing_nm: 6.0,
            strict_safety: true,
        },
        ScenarioDefinition {
            id: "approach-spacing".into(),
            name: "Approach spacing".into(),
            description: "A high-workload final requiring vectors, speed control, and spacing.".into(),
            recommended_role: ControllerRole::Approach,
            spawn_interval_s: 50.0,
            arrival_spacing_nm: 5.0,
            strict_safety: true,
        },
        ScenarioDefinition {
            id: "instructor-lab".into(),
            name: "Instructor lab".into(),
            description: "Allows unsafe clearances so the training monitor can demonstrate consequences.".into(),
            recommended_role: ControllerRole::Tower,
            spawn_interval_s: 35.0,
            arrival_spacing_nm: 3.0,
            strict_safety: false,
        },
    ]
}

pub fn find(id: Option<&str>) -> ScenarioDefinition {
    let id = id.unwrap_or("free-play");
    builtins().into_iter().find(|scenario| scenario.id == id).unwrap_or_else(|| builtins()[0].clone())
}
