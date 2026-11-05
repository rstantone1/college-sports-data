import { useEffect, useMemo, useState } from 'react';
import { ratingsFor } from '../api';
import { useAsync, useFollows } from '../hooks';
import { SPORTS, sportMeta } from '../sports';

const ORDER = ['mbb', 'wbb', 'cfb', 'bsb', 'sb'];

// Football in the fall, hoops in winter, baseball and softball in spring: the tab most people want first.
function startSport() {
  try { const s = localStorage.getItem('lastSport'); if (s && SPORTS[s]) return s; } catch { /* unavailable */ }
  const m = new Date().getMonth() + 1;
  return m >= 8 ? 'cfb' : m <= 4 ? 'mbb' : 'bsb';
}

// One screen to choose every team you follow: pick a sport, narrow by conference or search, tap a team to add or
// remove it. Changes save the moment you tap.
export function TeamPicker({ onClose }: { onClose: () => void }) {
  const [sport, setSport] = useState(startSport);
  const [q, setQ] = useState('');
  const [conf, setConf] = useState('top');
  const { list, has, toggle } = useFollows();
  const season = sportMeta(sport).seasons[0].year;
  const rs = useAsync(() => ratingsFor(sport, season), [sport]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  useEffect(() => { setConf('top'); setQ(''); }, [sport]);

  // Conferences, strongest first, so the ones people are looking for sit at the front of the row.
  const confs = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of rs.data ?? []) if (r.conference_short) m.set(r.conference_short, [...(m.get(r.conference_short) ?? []), r.rank]);
    return [...m.entries()].filter(([, v]) => v.length >= 4).map(([k, v]) => ({ k, avg: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => a.avg - b.avg).map((x) => x.k);
  }, [rs.data]);

  const shown = useMemo(() => {
    const all = rs.data ?? [];
    const s = q.trim().toLowerCase();
    if (s) return all.filter((r) => `${r.display_name} ${r.short_name} ${r.abbreviation} ${r.mascot ?? ''}`.toLowerCase().includes(s)).slice(0, 80);
    if (conf === 'top') return all.slice(0, 25);
    if (conf === 'all') return [...all].sort((a, b) => a.short_name.localeCompare(b.short_name));
    return all.filter((r) => r.conference_short === conf);
  }, [rs.data, q, conf]);

  const count = (s: string) => list.filter((f) => f.sport === s).length;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet picker" role="dialog" aria-label="Pick your teams" onClick={(e) => e.stopPropagation()}>
        <div className="picker-top">
          <div className="sheet-head">
            <h3>Pick your teams</h3>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
          <div className="chips scroll" role="tablist" aria-label="Sport">
            {ORDER.map((s) => (
              <button key={s} role="tab" aria-selected={sport === s} className={`chip ${sport === s ? 'on' : ''}`} onClick={() => setSport(s)}>
                {sportMeta(s).short}{count(s) ? ` · ${count(s)}` : ''}
              </button>
            ))}
          </div>
          <input className="picker-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${sportMeta(sport).short.toLowerCase()} teams`} aria-label="Search teams" />
          {!q && (
            <div className="chips scroll" role="tablist" aria-label="Conference" style={{ marginTop: 10 }}>
              <button className={`chip ${conf === 'top' ? 'on' : ''}`} onClick={() => setConf('top')}>Top 25</button>
              {confs.map((c) => <button key={c} className={`chip ${conf === c ? 'on' : ''}`} onClick={() => setConf(c)}>{c}</button>)}
              <button className={`chip ${conf === 'all' ? 'on' : ''}`} onClick={() => setConf('all')}>All teams A–Z</button>
            </div>
          )}
        </div>
        <div className="picker-list">
          {rs.loading ? <p className="muted" style={{ padding: 16 }}>Loading teams…</p> : shown.length === 0 ? <p className="muted" style={{ padding: 16 }}>No teams match "{q}".</p> : shown.map((r) => {
            const on = has(sport, r.team_id);
            return (
              <button key={r.team_id} className={`pick-row ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => toggle({ sport, season, team_id: r.team_id, name: r.short_name, logo: r.logo_url })}>
                {r.logo_url ? <img src={r.logo_url} alt="" loading="lazy" /> : <span style={{ width: 32 }} />}
                <span><b>{r.short_name}</b><span className="muted sm"> #{r.rank}{r.conference_short ? ` · ${r.conference_short}` : ''}</span></span>
                <span className="chk" aria-hidden="true">{on ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="picker-foot">
          <button className="btn" style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: 17 }} onClick={onClose}>
            {list.length ? `Done · following ${list.length}` : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
