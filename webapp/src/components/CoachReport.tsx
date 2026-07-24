import type { SessionRecord } from "../lib/types";
import { SessionHistoryChart } from "./SessionHistoryChart";
import "./CoachReport.css";

interface CoachReportProps {
  latest: SessionRecord | null;
  history: SessionRecord[];
}

export function CoachReport({ latest, history }: CoachReportProps) {
  if (!latest && history.length === 0) return null;

  return (
    <div className="coachReport">
      <h3>AI Coach</h3>
      {latest && (
        <div className="coachReport__metrics">
          <div className="metric">
            <div className="metric__k">Duration</div>
            <div className="metric__v">{Math.round(latest.durationSec)}s</div>
          </div>
          <div className="metric">
            <div className="metric__k">Pace</div>
            <div className="metric__v">{latest.wpm} wpm</div>
          </div>
          <div className="metric">
            <div className="metric__k">Filler words</div>
            <div className="metric__v">{latest.fillerCount}</div>
          </div>
          <div className="metric">
            <div className="metric__k">Confidence</div>
            <div className="metric__v">{Math.round(latest.confidence)}</div>
          </div>
        </div>
      )}
      {history.length > 1 && (
        <div className="coachReport__history">
          <div className="coachReport__historyLabel">Confidence trend, last {Math.min(history.length, 10)} sessions</div>
          <SessionHistoryChart sessions={history.slice(-10)} />
        </div>
      )}
    </div>
  );
}
