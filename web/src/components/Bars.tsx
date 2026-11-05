// Percentile bars: each stat drawn as where it ranks among peers, 0 to 100, so a reader sees what a team or
// player is good and bad at without knowing what any stat means. 100 is always good, whichever direction the
// raw number runs. Colors are chosen to read for colorblind viewers too (warm = good, cool = bad).
export interface BarRow { label: string; value: string; pct: number | null; note?: string }

const color = (p: number) => {
  // 0 → cool blue, 50 → neutral gray, 100 → warm red. Steps through gray so the middle reads as "average".
  if (p >= 50) { const t = (p - 50) / 50; return `color-mix(in oklab, var(--bar-mid) ${Math.round((1 - t) * 100)}%, var(--bar-hot))`; }
  const t = (50 - p) / 50; return `color-mix(in oklab, var(--bar-mid) ${Math.round((1 - t) * 100)}%, var(--bar-cold))`;
};

export function Bars({ rows, title, hint }: { rows: BarRow[]; title?: string; hint?: string }) {
  return (
    <div className="bars">
      {title && <div className="bars-head"><h3>{title}</h3>{hint && <span className="muted sm">{hint}</span>}</div>}
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={r.note}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            {r.pct != null && <span className="bar-fill" style={{ width: `${Math.max(3, r.pct)}%`, background: color(r.pct) }} />}
            {r.pct != null && <span className="bar-pct" style={{ left: `min(calc(${r.pct}% + 6px), calc(100% - 28px))` }}>{r.pct}</span>}
          </span>
          <span className="bar-val num">{r.value}</span>
        </div>
      ))}
      <div className="bar-key muted sm"><span><i style={{ background: 'var(--bar-cold)' }} /> worse than most</span><span><i style={{ background: 'var(--bar-mid)' }} /> average</span><span><i style={{ background: 'var(--bar-hot)' }} /> better than most</span><span>Number = rank out of 100</span></div>
    </div>
  );
}
