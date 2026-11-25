import type { AirportData, TrainingEvent } from "../types";
import type { ReplayCheckpoint, TrainingAction } from "../trainingSession";
import { buildTrainingReport, downloadTrainingReport, scenarioObjectives } from "../trainingSession";

interface Props {
  events: TrainingEvent[];
  airport: AirportData;
  role: string;
  scenarioId: string;
  durationS: number;
  actions: TrainingAction[];
  checkpoints: ReplayCheckpoint[];
  replayIndex: number | null;
  onReplayIndex: (index: number | null) => void;
  debrief?: boolean;
  onClose: () => void;
}

const labels: Record<TrainingEvent["kind"], string> = {
  runway_conflict: "Runway conflict",
  runway_incursion: "Runway incursion",
  taxi_conflict: "Taxiway conflict",
  loss_of_separation: "Loss of separation",
  unsafe_clearance: "Unsafe clearance",
};

export function TrainingPanel({ events, airport, role, scenarioId, durationS, actions, checkpoints, replayIndex, onReplayIndex, debrief, onClose }: Props) {
  const ordered = [...events].sort((a, b) => b.id - a.id);
  const report = buildTrainingReport(airport.icao, role, scenarioId, durationS, events, actions, checkpoints);
  const objectives = scenarioObjectives(scenarioId, events, actions);
  return (
    <div className="training-panel modal-panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">{debrief ? "Session debrief" : "Training events"}</div>
          <div className="panel-subheader">Score {report.score.overall}/100 · {events.length} safety events · {checkpoints.length} replay points</div>
        </div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>
      <div className="training-score-grid">
        <span>Safety <strong>{report.score.safety}</strong></span>
        <span>Discipline <strong>{report.score.discipline}</strong></span>
        <span>Workload <strong>{report.score.workload}</strong></span>
      </div>
      <div className="training-objectives">
        {objectives.map((objective) => <div key={objective.id}>{objective.completed ? "✓" : "○"} {objective.label}</div>)}
      </div>
      <button onClick={() => downloadTrainingReport(report)}>Export training report</button>
      {checkpoints.length > 1 && (
        <div className="replay-controls">
          <label>Replay {replayIndex == null ? "live" : `${replayIndex + 1}/${checkpoints.length}`}</label>
          <input type="range" min="0" max={checkpoints.length - 1} value={replayIndex ?? checkpoints.length - 1} onChange={(event) => onReplayIndex(Number(event.target.value))} />
          {replayIndex != null && <button onClick={() => onReplayIndex(null)}>Return to live</button>}
        </div>
      )}
      {ordered.length === 0 ? <p className="muted">No safety events in this session.</p> : (
        <div className="training-event-list">
          {ordered.map((event) => (
            <div className={`training-event severity-${event.severity}`} key={event.id}>
              <div className="training-event-topline">
                <strong>{labels[event.kind]}</strong>
                <span>{Math.floor(event.clock_s / 60).toString().padStart(2, "0")}:{Math.floor(event.clock_s % 60).toString().padStart(2, "0")}</span>
              </div>
              <div>{event.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
