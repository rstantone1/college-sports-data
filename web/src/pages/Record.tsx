import { useState } from 'react';
import { Link } from 'react-router-dom';
import { restAll } from '../api';
import { useAsync, fmtDate } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { pct } from '../model';
import { SPORTS, sportMeta } from '../sports';

interface Row {
  sport_id: string; season_year: number; game_id: number; kind: string; made_at: string; home_prob: number; margin: number; estimated: boolean;
  games: { home_score: number | null; away_score: number | null; completed: boolean; start_time: string; home_team_id: number; away_team_id: number } | null;
}

// Every pick we made, scored against what happened. Live picks are written before tip and never edited.
// "Replayed" picks come from running the model week by week over a past season it had not seen.
export function RecordPage() {
  const [kind, setKind] = useState<'live' | 'replay'>('live');
  const [sport, setSport] = useState<string>('all');
  const data = useAsync(() => restAll<Row>(`predictions?select=sport_id,season_year,game_id,kind,made_at,home_prob,margin,estimated,games(home_score,away_score,completed,start_time,home_team_id,away_team_id)&estimated=eq.false&order=made_at.desc`), []);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error} />;
  const all = (data.data ?? []).map((r) => ({ ...r, home_prob: Number(r.home_prob), margin: Number(r.margin) }));
  const kinds = new Set(all.map((r) => r.kind));
  const rows = all.filter((r) => r.kind === kind && (sport === 'all' || r.sport_id === sport));
  const scored = rows.filter((r) => r.games?.completed && r.games.home_score != null && r.games.home_score !== r.games.away_score);
  const pending = rows.length - scored.length;

  const right = scored.filter((r) => (r.home_prob >= 0.5) === (r.games!.home_score! > r.games!.away_score!)).length;
  const mae = scored.length ? scored.reduce((a, r) => a + Math.abs(r.margin - (r.games!.home_score! - r.games!.away_score!)), 0) / scored.length : 0;
  const bins = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 1.01]].map(([lo, hi]) => {
    const inBin = scored.filter((r) => { const f = Math.max(r.home_prob, 1 - r.home_prob); return f >= lo && f < hi; });
    const won = inBin.filter((r) => (r.home_prob >= 0.5) === (r.games!.home_score! > r.games!.away_score!)).length;
    const said = inBin.length ? inBin.reduce((a, r) => a + Math.max(r.home_prob, 1 - r.home_prob), 0) / inBin.length : 0;
    return { lo, hi, n: inBin.length, won: inBin.length ? won / inBin.length : 0, said };
  });
  const bySport = Object.keys(SPORTS).map((s) => {
    const x = scored.filter((r) => r.sport_id === s);
    const w = x.filter((r) => (r.home_prob >= 0.5) === (r.games!.home_score! > r.games!.away_score!)).length;
    return { s, n: x.length, w };
  }).filter((x) => x.n > 0);
  const first = scored.length ? scored[scored.length - 1].made_at : null;
  const inWords = (p: number) => { const n = Math.round(1 / Math.max(0.01, 1 - p)); return n >= 2 && n <= 20 ? `about ${n - 1} in ${n}` : ''; };

  return (
    <>
      <Back />
      <h1>Track record</h1>
      <p className="sub">Every pick we make is locked in before the game starts and never changed. Here's how they turned out, good or bad.</p>
      <div className="chips">
        <button className={`chip ${kind === 'live' ? 'on' : ''}`} onClick={() => setKind('live')}>This season</button>
        {kinds.has('replay') && <button className={`chip ${kind === 'replay' ? 'on' : ''}`} onClick={() => setKind('replay')}>Past seasons</button>}
        <span style={{ width: 8 }} />
        <button className={`chip ${sport === 'all' ? 'on' : ''}`} onClick={() => setSport('all')}>All sports</button>
        {Object.values(SPORTS).map((s) => <button key={s.id} className={`chip ${sport === s.id ? 'on' : ''}`} onClick={() => setSport(s.id)}>{s.short}</button>)}
      </div>
      {kind === 'replay' && <p className="muted sm">Past seasons: we replayed each season week by week, using only the games already played at that point, and predicted the next week. The system never saw the results. It's how we tested it before using it live.</p>}
      {kind === 'live' && first && <p className="muted sm">Live since {fmtDate(first, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>}

      {!scored.length ? (
        <div className="panel empty">
          <p>{pending ? `We've made ${pending} picks so far. Waiting on the games.` : 'No results yet.'}</p>
          <p className="muted sm">Results show up here as soon as the games finish.</p>
        </div>
      ) : (
        <>
          <div className="cards" style={{ marginBottom: 16 }}>
            <div className="card"><div className="k">Games</div><div className="v">{scored.length.toLocaleString()}</div><div className="r">{pending ? `${pending} still to play` : 'all results in'}</div></div>
            <div className="card"><div className="k">Picked the winner</div><div className="v" style={{ color: 'var(--win)' }}>{pct(right / scored.length)}</div><div className="r">{right.toLocaleString()} of {scored.length.toLocaleString()}</div></div>
            <div className="card"><div className="k">Average miss on the margin</div><div className="v">{mae.toFixed(1)}</div><div className="r">points or runs, off the final margin</div></div>
          </div>
          <div className="grid g2e">
            <div className="panel">
              <h3>Do the percentages mean what they say?</h3>
              <p className="muted sm">When we gave the favorite a chance in each range, how often did the favorite win? If our numbers are honest, the two columns should be close.</p>
              <table className="box">
                <thead><tr><th>We said</th><th>Games</th><th>Favorite won</th><th className="hide-sm">In words</th></tr></thead>
                <tbody>
                  {bins.filter((b) => b.n).map((b) => (
                    <tr key={b.lo}>
                      <td>{Math.round(b.lo * 100)}–{Math.min(100, Math.round(b.hi * 100))}% <span className="muted sm">(avg {pct(b.said)})</span></td>
                      <td>{b.n.toLocaleString()}</td>
                      <td className="num" style={{ color: Math.abs(b.won - b.said) < 0.05 ? 'var(--win)' : 'var(--gold)' }}>{pct(b.won)}</td>
                      <td className="hide-sm muted sm">{inWords(b.said)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>By sport</h3>
              <table className="box">
                <thead><tr><th>Sport</th><th>Games</th><th>Picked winner</th></tr></thead>
                <tbody>{bySport.map((x) => <tr key={x.s}><td>{sportMeta(x.s).long}</td><td>{x.n.toLocaleString()}</td><td className="num">{pct(x.w / x.n)}</td></tr>)}</tbody>
              </table>
              <p className="muted sm" style={{ margin: '10px 0 0' }}>Games against teams from lower divisions don't count here. <Link to="/about" style={{ color: 'var(--cool)' }}>How the numbers work</Link></p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
