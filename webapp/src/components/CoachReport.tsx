import type { SessionRecord } from "../lib/types";
import { SessionHistoryChart } from "./SessionHistoryChart";
import "./CoachReport.css";

interface CoachReportProps {
  latest: SessionRecord | null;
  history: SessionRecord[];
  /** True when `latest` is an ephemeral Practice Mode summary (never
   * written to storage) rather than a real saved session -- changes the
   * heading/copy so it's never ambiguous whether this result was recorded,
   * without needing a separate component for what's otherwise the exact
   * same metrics display. */
  isPractice?: boolean;
}

export function CoachReport({ latest, history, isPractice = false }: CoachReportProps) {
  if (!latest && history.length === 0) return null;

  return (
    <div className="coachReport">
      <h3>{isPractice ? "Practice Summary" : "AI Coach"}</h3>
      {isPractice && (
        <p className="coachReport__practiceNote">
          This run wasn't saved to your session history or confidence trend.
        </p>
      )}
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
          {typeof latest.freezeCount === "number" && (
            <div className="metric">
              <div className="metric__k">Tracking holds</div>
              <div className="metric__v">{latest.freezeCount}</div>
            </div>
          )}
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
