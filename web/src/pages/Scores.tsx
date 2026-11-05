import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rest, restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings, fmtTime } from '../hooks';
import { Loading, ErrorBox } from '../components/Shell';
import { predict, league, pct, outsider } from '../model';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function ScoresPage() {
  const { sport, season, base } = useCtx();
  const R = useRatings();
  const [sp, setSp] = useSearchParams();

  // Default day: today if it has games, otherwise the latest day with games this season.
  const latest = useAsync(() => rest<{ start_time: string }[]>(`games?select=start_time&sport_id=eq.${sport}&season_year=eq.${season}&start_time=lte.${new Date(Date.now() + 864e5).toISOString()}&order=start_time.desc&limit=1`), [sport, season]);
  const day = sp.get('d') ?? (latest.data?.[0] ? ymd(new Date(latest.data[0].start_time)) : ymd(new Date()));
  const start = new Date(`${day}T00:00:00`), end = new Date(start.getTime() + 864e5);
  const games = useAsync(() => restAll<Game>(`v_games?sport_id=eq.${sport}&start_time=gte.${start.toISOString()}&start_time=lt.${end.toISOString()}&order=start_time.asc`), [sport, day]);

  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  const L = useMemo(() => league(R.data ?? []), [R.data]);
  const shift = (n: number) => { const d = new Date(start); d.setDate(d.getDate() + n); setSp({ d: ymd(d) }, { replace: true }); };

  if (R.loading || latest.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;

  let called = 0, right = 0;
  const cards = (games.data ?? []).map((g) => {
    const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
    // One unrated side (a non-Division I opponent) gets a stand-in rating so there's still a pick; two unrated sides get nothing.
    const est = (H && !A) || (A && !H);
    const pr = H && A ? predict(H, A, L, g.neutral_site ? 0 : 1, sport)
      : est ? predict(H ?? outsider(L, sport), A ?? outsider(L, sport), L, g.neutral_site ? 0 : 1, sport) : null;
    const final = g.completed && g.home_score != null;
    const homeWon = final && g.home_score! > g.away_score!;
    if (final && pr && !est) { called++; if ((pr.aWin >= .5) === homeWon) right++; }
    const line = (side: 'away' | 'home') => {
      const isHome = side === 'home';
      const name = isHome ? g.home_name : g.away_name, logo = isHome ? g.home_logo : g.away_logo;
      const sc = isHome ? g.home_score : g.away_score, r = isHome ? H : A;
      const lost = final && (isHome ? !homeWon : homeWon);
      const p = pr ? (isHome ? pr.aWin : 1 - pr.aWin) : null;
      return (
        <div className={`gl ${lost ? 'lose' : ''}`}>
          {logo ? <img src={logo} alt="" /> : <span />}
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r && <span className="muted sm">{r.rank} </span>}{name}
          </span>
          <span className="sc">{final ? sc : p != null ? <span className="pill" style={{ fontSize: 13 }}>{pct(p)}</span> : ''}</span>
        </div>
      );
    };
    const upset = final && pr && (pr.aWin >= .5) !== homeWon && Math.max(pr.aWin, 1 - pr.aWin) > .75;
    return (
      <Link key={g.id} to={`${base}/game/${g.id}`} className="gcard">
        {line('away')}{line('home')}
        <div className="gfoot">
          <span>{final ? 'Final' : fmtTime(g.start_time)}{g.neutral_site ? ' · Neutral' : ''}</span>
          {upset && !est ? <span className="pill loss">Upset</span> : pr && !final ? <span>{(pr.aWin >= .5 ? g.home_abbr : g.away_abbr)} by {Math.abs(pr.margin).toFixed(est ? 0 : 1)}{est ? ' · est.' : ''}</span> : !pr && !final ? <span>Not rated</span> : null}
        </div>
      </Link>
    );
  });

  return (
    <>
      <h1>Scores and picks</h1>
      <p className="sub">Every Division I game of the day. Before tip, the model's pick. After, the final.</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous day">‹</button>
        <input type="date" value={day} onChange={(e) => e.target.value && setSp({ d: e.target.value }, { replace: true })}
          style={{ font: 'inherit', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--panel)', color: 'var(--ink)', fontWeight: 600 }} />
        <button className="btn ghost" onClick={() => shift(1)} aria-label="Next day">›</button>
        <span className="muted">{games.data?.length ?? 0} games</span>
        {called > 0 && <span className="pill win" style={{ fontSize: 14 }}>Model went {right}-{called - right} ({pct(right / called)})</span>}
      </div>
      {games.loading ? <Loading rows={6} /> : cards.length ? <div className="games">{cards}</div> : <div className="panel empty">No games on this day.</div>}
    </>
  );
}
