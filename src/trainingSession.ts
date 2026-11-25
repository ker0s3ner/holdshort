import type { AircraftSnapshot, Clearance, TrainingEvent } from "./types";

export interface TrainingAction {
  at: number;
  callsign: string;
  clearance: Clearance;
  accepted: boolean;
}

export interface ReplayCheckpoint {
  clock_s: number;
  aircraft: AircraftSnapshot[];
}

export interface TrainingReport {
  version: 1;
  airport: string;
  role: string;
  scenarioId: string;
  duration_s: number;
  score: {
    overall: number;
    safety: number;
    discipline: number;
    workload: number;
  };
  events: TrainingEvent[];
  actions: TrainingAction[];
  checkpoints: ReplayCheckpoint[];
}

export function buildTrainingReport(
  airport: string,
  role: string,
  scenarioId: string,
  duration_s: number,
  events: TrainingEvent[],
  actions: TrainingAction[],
  checkpoints: ReplayCheckpoint[],
): TrainingReport {
  const safety = Math.max(0, 100 - events.reduce((sum, event) => sum + event.severity * 12, 0));
  const discipline = Math.max(0, 100 - actions.filter((action) => !action.accepted).length * 8);
  const workload = Math.min(100, Math.round(Math.min(actions.length / 20, 1) * 100));
  const overall = Math.round(safety * 0.6 + discipline * 0.25 + workload * 0.15);
  return { version: 1, airport, role, scenarioId, duration_s, score: { overall, safety, discipline, workload }, events, actions, checkpoints };
}

export interface ScenarioObjective {
  id: string;
  label: string;
  completed: boolean;
}

export function scenarioObjectives(scenarioId: string, events: TrainingEvent[], actions: TrainingAction[]): ScenarioObjective[] {
  const safe = events.length === 0;
  const accepted = actions.filter((action) => action.accepted).length;
  if (scenarioId === "tower-runway-surge") return [
    { id: "safe", label: "Keep the runway conflict-free", completed: safe },
    { id: "workload", label: "Process at least five clearances", completed: accepted >= 5 },
  ];
  if (scenarioId === "approach-spacing") return [
    { id: "separation", label: "Maintain separation throughout the final", completed: safe },
    { id: "vectoring", label: "Issue at least three approach instructions", completed: accepted >= 3 },
  ];
  if (scenarioId === "instructor-lab") return [
    { id: "review", label: "Produce a debrief with recorded events", completed: events.length > 0 },
  ];
  return [{ id: "safe", label: "Complete a session without safety events", completed: safe }];
}

export function downloadTrainingReport(report: TrainingReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.airport}-${report.role}-training.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
