import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rest, restAll, ratingsFor, type Game, type Rating } from '../api';
import { useAsync, useCtx, useRatings, useFollows, fmtTime, fmtDate, type Follow } from '../hooks';
import { Loading, ErrorBox } from '../components/Shell';
import { predict, league, pct, outsider, type League } from '../model';
import { sportMeta } from '../sports';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isToday = (d: string) => d === ymd(new Date());

// The front door: your teams, the games worth watching tonight, then every game of the day with the model's pick.
export function TodayPage() {
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const [sp, setSp] = useSearchParams();
  const { list: follows } = useFollows();

  // Opens on today. If today has no games (off-season, holidays), offer a jump to the last day that did.
  // Default day: today if it has games, otherwise the most recent day that did (the schedule runs a few days ahead).
  const todayEnd = new Date(`${ymd(new Date())}T23:59:59`);
  const latest = useAsync(() => rest<{ start_time: string }[]>(`games?select=start_time&sport_id=eq.${sport}&season_year=eq.${season}&start_time=lte.${todayEnd.toISOString()}&order=start_time.desc&limit=1`), [sport, season]);
  const day = sp.get('d') ?? ymd(new Date());
  const start = new Date(`${day}T00:00:00`), end = new Date(start.getTime() + 864e5);
  const games = useAsync(() => restAll<Game>(`v_games?sport_id=eq.${sport}&start_time=gte.${start.toISOString()}&start_time=lt.${end.toISOString()}&order=start_time.asc`), [sport, day]);

  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  const L = useMemo(() => league(R.data ?? []), [R.data]);
  const shift = (n: number) => { const d = new Date(start); d.setDate(d.getDate() + n); setSp({ d: ymd(d) }, { replace: true }); };

  if (R.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;

  const N = R.data!.length || 1;
  let called = 0, right = 0;
  const rows = (games.data ?? []).map((g) => {
    const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
    const est = !!((H && !A) || (A && !H));
    const pr = H && A ? predict(H, A, L, g.neutral_site ? 0 : 1, sport)
      : est ? predict(H ?? outsider(L, sport), A ?? outsider(L, sport), L, g.neutral_site ? 0 : 1, sport) : null;
    const final = g.completed && g.home_score != null;
    const homeWon = final && g.home_score! > g.away_score!;
    if (final && pr && !est) { called++; if ((pr.aWin >= .5) === homeWon) right++; }
    // Worth watching: how good both teams are, and how close the game should be.
    const quality = H && A ? 1 - (H.rank + A.rank) / (2 * N) : 0;
    const closeness = pr ? 1 - Math.abs(2 * pr.aWin - 1) : 0;
    const watch = H && A && !final ? quality * (0.45 + 0.55 * closeness) : 0;
    return { g, H, A, est, pr, final, homeWon, watch };
  });
  const watchList = [...rows].filter((r) => r.watch > 0).sort((a, b) => b.watch - a.watch).slice(0, 4);
  const card = (r: typeof rows[number]) => <GameCard key={r.g.id} {...r} base={base} />;

  return (
    <>
      <div className="dayhead">
        <h1>{isToday(day) ? 'Today' : fmtDate(start.toISOString(), { weekday: 'short', month: 'short', day: 'numeric' })}</h1>
        <div className="daynav">
          <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous day">‹</button>
          <input type="date" value={day} aria-label="Pick a day" onChange={(e) => e.target.value && setSp({ d: e.target.value }, { replace: true })} />
          <button className="btn ghost" onClick={() => shift(1)} aria-label="Next day">›</button>
          {!isToday(day) && <button className="btn ghost" onClick={() => setSp({}, { replace: true })}>Today</button>}
        </div>
      </div>

      {isToday(day) && <YourTeams follows={follows} />}

      {watchList.length > 0 && isToday(day) && (
        <section style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 22 }}>Worth watching</h2>
          <p className="muted sm" style={{ margin: '-6px 0 10px' }}>Good teams, close game. Ranked by both.</p>
          <div className="games">{watchList.map(card)}</div>
        </section>
      )}

      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>{isToday(day) ? `All ${meta.long.toLowerCase()} games` : `${rows.length} games`}</h2>
          <span className="muted sm">{isToday(day) ? `${rows.length} games` : ''}</span>
          {called > 0 && <span className="pill win" style={{ marginLeft: 'auto' }}>Model {right}-{called - right} ({pct(right / called)})</span>}
        </div>
        {games.loading ? <Loading rows={6} /> : rows.length ? <div className="games">{rows.map(card)}</div> : <div className="panel empty">No games on this day.{latest.data?.[0] && ymd(new Date(latest.data[0].start_time)) !== day && <> <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setSp({ d: ymd(new Date(latest.data![0].start_time)) }, { replace: true })}>Go to the last game day</button></>}</div>}
      </section>
    </>
  );
}

export function GameCard({ g, H, A, est, pr, final, homeWon, base }: { g: Game; H?: Rating; A?: Rating; est: boolean; pr: ReturnType<typeof predict> | null; final: boolean; homeWon: boolean; base: string }) {
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
  const upset = final && pr && !est && (pr.aWin >= .5) !== homeWon && Math.max(pr.aWin, 1 - pr.aWin) > .75;
  return (
    <Link to={`${base}/game/${g.id}`} className="gcard">
      {line('away')}{line('home')}
      <div className="gfoot">
        <span>{final ? 'Final' : fmtTime(g.start_time)}{g.neutral_site ? ' · Neutral' : ''}</span>
        {upset ? <span className="pill loss">Upset</span> : pr && !final ? <span>{(pr.aWin >= .5 ? g.home_abbr : g.away_abbr)} by {Math.abs(pr.margin).toFixed(est ? 0 : 1)}{est ? ' · est.' : ''}</span> : !pr && !final ? <span>Not rated</span> : null}
      </div>
    </Link>
  );
}

// Followed teams, across sports: next game with the pick, and the last result.
export function YourTeams({ follows }: { follows: Follow[] }) {
  const data = useAsync(async () => {
    const out = [];
    for (const f of follows) {
      const meta = sportMeta(f.sport);
      const season = meta.seasons[0].year;
      const [rs, next, last] = await Promise.all([
        ratingsFor(f.sport, season),
        rest<Game[]>(`v_games?sport_id=eq.${f.sport}&season_year=eq.${season}&completed=eq.false&start_time=gte.${new Date(Date.now() - 4 * 3600e3).toISOString()}&or=(home_team_id.eq.${f.team_id},away_team_id.eq.${f.team_id})&order=start_time.asc&limit=1`),
        rest<Game[]>(`v_games?sport_id=eq.${f.sport}&season_year=eq.${season}&completed=eq.true&or=(home_team_id.eq.${f.team_id},away_team_id.eq.${f.team_id})&order=start_time.desc&limit=1`),
      ]);
      out.push({ f, season, rs, next: next[0], last: last[0] });
    }
    return out;
  }, [follows.map((f) => `${f.sport}:${f.team_id}`).join(',')]);
  if (!follows.length) return (
    <div className="panel" style={{ marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 22 }}>☆</span>
      <span><b>Follow your teams.</b> <span className="muted">Open any team and tap the star. They'll show up here first, every day.</span></span>
    </div>
  );
  if (data.loading) return <Loading rows={3} />;
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 22 }}>Your teams</h2>
      <div className="games">
        {(data.data ?? []).map(({ f, season, rs, next, last }) => {
          const byId = new Map(rs.map((r) => [r.team_id, r]));
          const me = byId.get(f.team_id);
          const L: League = league(rs);
          const lastLine = last ? (() => {
            const home = last.home_team_id === f.team_id;
            const us = home ? last.home_score! : last.away_score!, them = home ? last.away_score! : last.home_score!;
            const oppName = home ? last.away_name : last.home_name;
            return <span className={us > them ? 'W' : 'L'}>{us > them ? 'W' : 'L'} {us}-{them} <span className="muted">{home ? 'vs' : 'at'} {oppName} · {fmtDate(last.start_time)}</span></span>;
          })() : <span className="muted">No games yet</span>;
          const nextLine = next && me ? (() => {
            const home = next.home_team_id === f.team_id;
            const opp = byId.get(home ? next.away_team_id : next.home_team_id);
            const oppName = home ? next.away_name : next.home_name;
            const pr = opp ? predict(me, opp, L, next.neutral_site ? 0 : home ? 1 : -1, f.sport) : null;
            const today = ymd(new Date(next.start_time)) === ymd(new Date());
            return <span>{today ? 'Today' : fmtDate(next.start_time, { weekday: 'short', month: 'short', day: 'numeric' })} {fmtTime(next.start_time)} · {next.neutral_site ? 'vs' : home ? 'vs' : 'at'} {oppName}{opp ? ` (#${opp.rank})` : ''}{pr ? <> · <b>{pct(pr.aWin)}</b> to win</> : ''}</span>;
          })() : <span className="muted">No upcoming game on the schedule</span>;
          return (
            <Link key={`${f.sport}:${f.team_id}`} to={`/${f.sport}/${season}/team/${f.team_id}`} className="gcard" style={{ borderLeft: `4px solid ${me?.color ? '#' + me.color : 'var(--rule)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                {f.logo && <img src={f.logo} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />}
                <b style={{ fontSize: 17 }}>{f.name}</b>
                <span className="muted sm" style={{ marginLeft: 'auto' }}>{sportMeta(f.sport).short}{me ? ` · #${me.rank}` : ''}</span>
              </div>
              <div className="sm" style={{ display: 'grid', gap: 4 }}>
                <div><span className="muted">Next: </span>{nextLine}</div>
                <div><span className="muted">Last: </span>{lastLine}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
