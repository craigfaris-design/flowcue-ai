import type { SessionRecord } from "../lib/types";

interface SessionHistoryChartProps {
  sessions: SessionRecord[];
}

const WIDTH = 260;
const HEIGHT = 70;
const PADDING = 6;

export function SessionHistoryChart({ sessions }: SessionHistoryChartProps) {
  if (sessions.length < 2) return null;

  const values = sessions.map((s) => s.confidence);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = PADDING + (i / (values.length - 1)) * (WIDTH - PADDING * 2);
    const y = HEIGHT - PADDING - ((v - min) / range) * (HEIGHT - PADDING * 2);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Confidence trend chart">
      <polyline points={points.join(" ")} fill="none" stroke="#c2603e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((_v, i) => {
        const [x, y] = points[i].split(",").map(Number);
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#c2603e" />;
      })}
    </svg>
  );
}
