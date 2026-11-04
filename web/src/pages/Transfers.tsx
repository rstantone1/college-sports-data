import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { restAll } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Loading, ErrorBox } from '../components/Shell';

export interface Transfer {
  player_id: number; display_name: string; position: string | null; class_year: string | null; height_in: number | null; hometown: string | null; home_state: string | null;
  from_team_id: number; from_team: string; from_logo: string | null; from_conf: string | null;
  to_team_id: number; to_team: string; to_logo: string | null; to_conf: string | null;
  gp: number | null; gs: number | null; min: number | null; pts: number | null; reb: number | null; ast: number | null; fgm: number | null; fga: number | null; tpm: number | null; tpa: number | null;
}

const ht = (n: number | null) => (n ? `${Math.floor(n / 12)}'${n % 12}"` : '');
const pg = (v: number | null, gp: number | null) => (v != null && gp ? (Number(v) / gp).toFixed(1) : '–');

export function TransfersPage() {
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const t = useAsync(() => restAll<Transfer>(`v_transfers?sport_id=eq.${sport}&season_year=eq.${season}&order=pts.desc.nullslast`), [sport, season]);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'up' | 'in' | 'out'>('all');
  const [conf, setConf] = useState('All');
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);

  if (!meta.hoops) return <div className="panel empty"><h2>Transfer tracking covers basketball for now.</h2><p>Baseball and softball box scores don't carry stable player ids yet, so moves can't be matched reliably.</p></div>;
  if (t.loading || R.loading) return <Loading />;
  if (t.error) return <ErrorBox msg={t.error} />;

  const all = t.data ?? [];
  const confs = [...new Set(all.flatMap((x) => [x.to_conf, x.from_conf]).filter(Boolean) as string[])].sort();
  const rows = all.filter((x) => {
    if (conf !== 'All' && x.to_conf !== conf && x.from_conf !== conf) return false;
    if (mode === 'up') { const a = byId.get(x.from_team_id)?.rank ?? 999, b = byId.get(x.to_team_id)?.rank ?? 999; if (b >= a) return false; }
    if (q) { const s = q.toLowerCase(); if (!`${x.display_name} ${x.from_team} ${x.to_team}`.toLowerCase().includes(s)) return false; }
    return true;
  });
  const doubleDigit = all.filter((x) => x.gp && x.gp >= 10 && Number(x.pts) / x.gp >= 10).length;
  const starters = all.filter((x) => x.gp && x.gs && x.gs >= x.gp / 2 && x.gp >= 10).length;

  return (
    <>
      <h1>Transfer tracker</h1>
      <p className="sub">Every player who changed schools since last season, with what they produced before the move. Stats are last season's per-game averages at the old school. The list fills in as players appear in games.</p>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><div className="k">Players moved</div><div className="v">{all.length.toLocaleString()}</div><div className="r">with a game on record at both schools</div></div>
        <div className="card"><div className="k">Double-digit scorers</div><div className="v">{doubleDigit}</div><div className="r">averaged 10+ points last season</div></div>
        <div className="card"><div className="k">Starters</div><div className="v">{starters}</div><div className="r">started most of their games last season</div></div>
        <div className="card"><div className="k">Moved up</div><div className="v">{all.filter((x) => (byId.get(x.to_team_id)?.rank ?? 999) < (byId.get(x.from_team_id)?.rank ?? 999)).length}</div><div className="r">to a higher-rated program</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player or school" aria-label="Search"
          style={{ font: 'inherit', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--panel)', color: 'var(--ink)', minWidth: 220 }} />
        <select value={conf} onChange={(e) => setConf(e.target.value)} style={{ font: 'inherit', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--panel)', color: 'var(--ink)' }}>
          <option>All</option>{confs.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${mode === 'all' ? 'on' : ''}`} onClick={() => setMode('all')}>All moves</button>
          <button className={`chip ${mode === 'up' ? 'on' : ''}`} onClick={() => setMode('up')}>Moved up</button>
        </div>
      </div>
      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th className="l">Player</th><th className="l">From</th><th className="l">To</th><th>GP</th><th>PPG</th><th>RPG</th><th>APG</th><th className="hide-sm">FG%</th><th className="hide-sm">3P%</th></tr></thead>
            <tbody>
              {rows.slice(0, 400).map((x) => {
                const f = byId.get(x.from_team_id), to = byId.get(x.to_team_id);
                const fg = x.fga ? `${(100 * Number(x.fgm) / Number(x.fga)).toFixed(0)}%` : '–', tp = x.tpa ? `${(100 * Number(x.tpm) / Number(x.tpa)).toFixed(0)}%` : '–';
                return (
                  <tr key={`${x.player_id}-${x.to_team_id}`}>
                    <td className="l"><Link to={`${base}/player/${x.player_id}`}><b>{x.display_name}</b></Link><div className="muted sm">{[x.position, x.class_year, ht(x.height_in), x.hometown && x.home_state ? `${x.hometown}, ${x.home_state}` : x.hometown].filter(Boolean).join(' · ')}</div></td>
                    <td className="l"><Link to={`${base}/team/${x.from_team_id}`} className="team">{x.from_logo && <img src={x.from_logo} alt="" />}<span>{x.from_team}{f && <span className="muted sm"> #{f.rank}</span>}</span></Link></td>
                    <td className="l"><Link to={`${base}/team/${x.to_team_id}`} className="team">{x.to_logo && <img src={x.to_logo} alt="" />}<span>{x.to_team}{to && <span className="muted sm"> #{to.rank}</span>}</span></Link></td>
                    <td className="num">{x.gp ?? '–'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{pg(x.pts, x.gp)}</td>
                    <td className="num">{pg(x.reb, x.gp)}</td>
                    <td className="num">{pg(x.ast, x.gp)}</td>
                    <td className="hide-sm num">{fg}</td>
                    <td className="hide-sm num">{tp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 400 && <p className="muted sm">Showing the first 400 of {rows.length}. Narrow it down with search or a conference.</p>}
        {!rows.length && <p className="muted">No moves match.</p>}
      </div>
    </>
  );
}
