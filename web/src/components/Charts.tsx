// Small hand-rolled SVG charts. No library.

export function LineChart({ points, color, height = 160, yLabel, invert = false }: {
  points: { x: string; y: number }[]; color: string; height?: number; yLabel?: string; invert?: boolean;
}) {
  if (points.length < 2) return <p className="muted sm">This fills in as the season goes.</p>;
  const W = 600, H = height, P = 28;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const x = (i: number) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v: number) => { const t = (v - lo) / (hi - lo); return invert ? P + t * (H - P * 2) : H - P - t * (H - P * 2); };
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={yLabel ?? 'chart'} style={{ display: 'block' }}>
      <line x1={P} x2={W - P} y1={y(lo)} y2={y(lo)} stroke="var(--rule)" />
      <line x1={P} x2={W - P} y1={y(hi)} y2={y(hi)} stroke="var(--rule)" strokeDasharray="3 4" />
      <text x={4} y={y(hi) + 4} fontSize="11" fill="var(--muted)">{hi.toFixed(0)}</text>
      <text x={4} y={y(lo) + 4} fontSize="11" fill="var(--muted)">{lo.toFixed(0)}</text>
      <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.y)} r="5" fill={color} />
      <text x={P} y={H - 6} fontSize="11" fill="var(--muted)">{points[0].x}</text>
      <text x={W - P} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{last.x}</text>
    </svg>
  );
}

// A tiny trend line with no axes: just the shape of the season, ending in a dot for today.
export function Spark({ values, color, w = 96, h = 30 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 3) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: 'block', flex: '0 0 auto' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill={color} />
    </svg>
  );
}

// Score margin through a game (home perspective). Positive = home leading.
export function FlowChart({ series, homeColor, awayColor, homeName, awayName }: {
  series: { t: number; m: number }[]; homeColor: string; awayColor: string; homeName: string; awayName: string;
}) {
  if (series.length < 3) return <p className="muted sm">No play-by-play for this game.</p>;
  const W = 640, H = 200, P = 20;
  const tMax = Math.max(...series.map((s) => s.t), 40);
  const mAbs = Math.max(8, ...series.map((s) => Math.abs(s.m)));
  const x = (t: number) => P + (t / tMax) * (W - P * 2);
  const y = (m: number) => H / 2 - (m / mAbs) * (H / 2 - P);
  let d = `M${x(0)},${y(0)}`;
  for (const s of series) d += `L${x(s.t).toFixed(1)},${y(s.m).toFixed(1)}`;
  const area = `${d}L${x(series[series.length - 1].t)},${H / 2}L${x(0)},${H / 2}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Score margin through the game">
      <defs>
        <clipPath id="top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
        <clipPath id="bot"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
      </defs>
      <path d={area} fill={homeColor} opacity=".85" clipPath="url(#top)" />
      <path d={area} fill={awayColor} opacity=".85" clipPath="url(#bot)" />
      <line x1={P} x2={W - P} y1={H / 2} y2={H / 2} stroke="var(--ink)" strokeWidth="1" />
      <line x1={x(tMax / 2)} x2={x(tMax / 2)} y1={P} y2={H - P} stroke="var(--rule)" strokeDasharray="3 4" />
      <text x={P} y={14} fontSize="12" fontWeight="700" fill="var(--muted)">{homeName} leads ↑</text>
      <text x={P} y={H - 4} fontSize="12" fontWeight="700" fill="var(--muted)">{awayName} leads ↓</text>
    </svg>
  );
}

// Half-court shot chart. ESPN coordinates: x 0-50 (sideline to sideline), y = feet from baseline.
export function ShotChart({ shots, color, title }: { shots: { x: number; y: number; made: boolean; three: boolean }[]; color: string; title: string }) {
  const W = 500, H = 470, s = 10;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} shot chart`} style={{ background: 'var(--soft)', borderRadius: 12 }}>
        <g fill="none" stroke="var(--rule)" strokeWidth="2">
          <rect x="1" y="1" width={W - 2} height={H - 2} rx="10" />
          <rect x={170} y={0} width={160} height={190} />
          <circle cx={250} cy={190} r={60} />
          <path d={`M30,0 L30,140 A237.5,237.5 0 0 0 470,140 L470,0`} />
          <circle cx={250} cy={52.5} r={7.5} stroke="var(--muted)" />
          <line x1={220} x2={280} y1={40} y2={40} stroke="var(--muted)" />
        </g>
        {shots.map((p, i) => p.made
          ? <circle key={i} cx={p.x * s} cy={p.y * s} r={6} fill={color} stroke="#fff" strokeWidth="1.5" />
          : <g key={i} stroke="var(--muted)" strokeWidth="2" opacity=".7"><line x1={p.x * s - 5} y1={p.y * s - 5} x2={p.x * s + 5} y2={p.y * s + 5} /><line x1={p.x * s + 5} y1={p.y * s - 5} x2={p.x * s - 5} y2={p.y * s + 5} /></g>)}
      </svg>
      <figcaption className="legend"><span><i style={{ background: color }} />Made</span><span>✕ Missed</span><span>{shots.filter((x) => x.made).length}/{shots.length} from the field</span></figcaption>
    </figure>
  );
}
