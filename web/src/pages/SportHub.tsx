import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { rest, restAll, type Game, type Rating } from '../api';
import { useAsync, useCtx, useRatings, visibleColor } from '../hooks';
import { Loading, TeamCell } from '../components/Shell';
import { predict, league, perGame, sign, ovr } from '../model';
import { GameCard } from './Today';

const OPENS: Record<string, string> = { mbb: 'November', wbb: 'November', cfb: 'late August', bsb: 'mid-February', sb: 'mid-February' };
const MONTHS: Record<string, number[]> = { mbb: [11, 12, 1, 2, 3, 4], wbb: [11, 12, 1, 2, 3, 4], cfb: [8, 9, 10, 11, 12, 1], bsb: [2, 3, 4, 5, 6], sb: [2, 3, 4, 5, 6] };
const inSeason = (s: string) => (MONTHS[s] ?? []).includes(new Date().getMonth() + 1);
const N = (v: any) => (v == null || v === '' ? 0 : Number(v));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A sport's front page: today's games, the top 25, stat leaders, who's moving, and how the conferences stack up.
// Every block links to its full page.
export function SportHub() {
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const t1 = new Date(t0.getTime() + 864e5);
  const today = useAsync(() => restAll<Game>(`v_games?sport_id=eq.${sport}&start_time=gte.${t0.toISOString()}&start_time=lt.${t1.toISOString()}&order=start_time.asc`), [sport]);
  const before = useAsync(async () => {
    const weekAgo = ymd(new Date(Date.now() - 7 * 864e5));
    const d = await rest<{ as_of: string }[]>(`ratings?select=as_of&sport_id=eq.${sport}&season_year=eq.${season}&as_of=lte.${weekAgo}&order=as_of.desc&limit=1`);
    const snap = d[0]?.as_of ?? (await rest<{ as_of: string }[]>(`ratings?select=as_of&sport_id=eq.${sport}&season_year=eq.${season}&order=as_of.asc&limit=1`))[0]?.as_of;
    if (!snap) return new Map<number, number>();
    const rows = await restAll<{ team_id: number; rank: number }>(`ratings?select=team_id,rank&sport_id=eq.${sport}&season_year=eq.${season}&as_of=eq.${snap}`);
    return new Map(rows.map((r) => [r.team_id, r.rank]));
  }, [sport, season]);
  // Leaders: this season once players have a few games, otherwise last season's.
  const leaders = useAsync(async () => {
    const src = meta.hoops ? 'mv_player_season' : sport === 'cfb' ? 'mv_cfb_season' : 'mv_diamond_season';
    let rows = await restAll<any>(`${src}?sport_id=eq.${sport}&season_year=eq.${season}`);
    let label = meta.seasons.find((x) => x.year === season)?.label ?? '';
    const maxGp = Math.max(0, ...rows.map((r) => N(r.gp ?? r.games ?? r.g_bat)));
    if (maxGp < 5) { rows = await restAll<any>(`${src}?sport_id=eq.${sport}&season_year=eq.${season - 1}`); label = `last season`; }
    return { rows, label };
  }, [sport, season]);

  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  if (R.loading) return <Loading />;
  const rs = R.data ?? [];
  if (!rs.length) return <div className="panel empty"><h2>{meta.long} hasn't started yet</h2><p>Ratings show up after the first games.</p></div>;
  const L = league(rs);

  const games = (today.data ?? []).map((g) => {
    const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
    const pr = H && A ? predict(H, A, L, g.neutral_site ? 0 : 1, sport) : null;
    const q = H && A ? 1 - (H.rank + A.rank) / (2 * rs.length) : 0;
    const score = pr ? q * q * (0.6 + 0.4 * (1 - Math.abs(2 * pr.aWin - 1))) : 0;
    return { g, H, A, pr, score, final: g.completed && g.home_score != null };
  }).sort((a, b) => b.score - a.score);

  const moved = rs.map((r) => ({ r, d: (before.data?.get(r.team_id) ?? r.rank) - r.rank })).filter((x) => x.d !== 0);
  const up = [...moved].sort((a, b) => b.d - a.d).slice(0, 5), down = [...moved].sort((a, b) => a.d - b.d).slice(0, 5);

  // Conference strength: average rating per game of each conference's teams.
  const confs = new Map<string, { n: number; s: number; best: Rating }>();
  for (const r of rs) {
    if (!r.conference_short) continue;
    const c = confs.get(r.conference_short) ?? { n: 0, s: 0, best: r };
    c.n++; c.s += perGame(r, sport).rating; if (r.rank < c.best.rank) c.best = r;
    confs.set(r.conference_short, c);
  }
  const confList = [...confs.entries()].map(([k, v]) => ({ k, avg: v.s / v.n, n: v.n, best: v.best })).filter((c) => c.n >= 4).sort((a, b) => b.avg - a.avg).slice(0, 10);
  const maxAvg = Math.max(...confList.map((c) => Math.abs(c.avg)), 1);

  const leaderSets = meta.hoops ? [
    { t: 'Points', v: (r: any) => N(r.pts) / N(r.gp), f: (v: number) => v.toFixed(1) },
    { t: 'Rebounds', v: (r: any) => N(r.reb) / N(r.gp), f: (v: number) => v.toFixed(1) },
    { t: 'Assists', v: (r: any) => N(r.ast) / N(r.gp), f: (v: number) => v.toFixed(1) },
  ] : sport === 'cfb' ? [
    { t: 'Passing yards', v: (r: any) => (r.stat_group === 'passing' ? N(r.totals.passingYards) : NaN), f: (v: number) => String(Math.round(v)) },
    { t: 'Rushing yards', v: (r: any) => (r.stat_group === 'rushing' ? N(r.totals.rushingYards) : NaN), f: (v: number) => String(Math.round(v)) },
    { t: 'Receiving yards', v: (r: any) => (r.stat_group === 'receiving' ? N(r.totals.receivingYards) : NaN), f: (v: number) => String(Math.round(v)) },
  ] : [
    { t: 'Hits', v: (r: any) => N(r.h), f: (v: number) => String(Math.round(v)) },
    { t: 'RBI', v: (r: any) => N(r.rbi), f: (v: number) => String(Math.round(v)) },
    { t: 'Strikeouts (pitching)', v: (r: any) => N(r.k), f: (v: number) => String(Math.round(v)) },
  ];
  const lrows = leaders.data?.rows ?? [];
  const maxGp = Math.max(1, ...lrows.map((r) => N(r.gp ?? r.games ?? r.g_bat)));
  const regulars = meta.hoops ? lrows.filter((r) => N(r.gp) >= maxGp * 0.4) : lrows;

  return (
    <>
      <h1 style={{ marginBottom: 14 }}>{meta.long}</h1>
      {!inSeason(sport) && <p className="sub" style={{ marginTop: -8 }}>Off-season: these are the final numbers from {meta.seasons.find((x) => x.year === season)?.label}.</p>}

      <section className="hub-sec">
        <div className="hub-head"><h2>Today</h2><Link to={`${base}/today`}>All {games.length} games ›</Link></div>
        {today.loading ? <Loading rows={2} /> : games.length ? (
          <div className="hscroll">{games.slice(0, 8).map((x) => <div key={x.g.id} className="hcard"><GameCard g={x.g} H={x.H} A={x.A} est={false} pr={x.pr} final={x.final} homeWon={x.final && x.g.home_score! > x.g.away_score!} base={base} /></div>)}</div>
        ) : OPENS[sport] && !inSeason(sport) ? <div className="panel"><b>Off-season.</b> <span className="muted">The next season starts in {OPENS[sport]}. Until then, everything here is last season's final numbers.</span></div> : <p className="muted">No games today. <Link to={`${base}/today`} style={{ color: 'var(--cool)' }}>See the schedule</Link></p>}
      </section>

      <div className="grid g2e">
        <section className="panel">
          <div className="hub-head"><h2>Top 25</h2><Link to={`${base}/rankings`}>All {rs.length} ›</Link></div>
          <table className="tbl">
            <thead><tr><th>#</th><th className="l">Team</th><th title="Overall, video-game style: 99 is the best team in the country">OVR</th><th>Rating</th></tr></thead>
            <tbody>
              {rs.slice(0, 25).map((r) => {
                const mv = (before.data?.get(r.team_id) ?? r.rank) - r.rank;
                return (
                  <tr key={r.team_id} className="row">
                    <td className="rk" style={{ fontSize: 16 }}>{r.rank}{mv !== 0 && <span className={`mv ${mv > 0 ? 'up' : 'dn'}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</span>}</td>
                    <td className="l"><Link to={`${base}/team/${r.team_id}`}><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></Link></td>
                    <td className="num"><span className="ovr-chip">{ovr(rs, r).ovr}</span></td>
                    <td className="num" style={{ color: r.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(perGame(r, sport).rating, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="grid" style={{ alignContent: 'start' }}>
          <section className="panel">
            <div className="hub-head"><h2>Stat leaders</h2><Link to={`${base}/stats`}>All stats ›</Link></div>
            {leaders.data?.label === 'last season' && <p className="muted sm" style={{ margin: '-4px 0 8px' }}>From last season until players have a few games.</p>}
            {leaders.loading ? <Loading rows={4} /> : (
              <div className="leader-grid">
                {leaderSets.map((ls) => {
                  const top = regulars.map((r) => ({ r, v: ls.v(r) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v).slice(0, 5);
                  return (
                    <div key={ls.t}>
                      <div className="leader-t">{ls.t}{meta.hoops ? <span className="muted sm"> per game</span> : null}</div>
                      {top.map((x, i) => {
                        const t = byId.get(x.r.team_id);
                        return (
                          <Link key={`${x.r.player_id}-${i}`} to={`${base}/player/${x.r.player_id}`} className="leader-row">
                            <span className="muted">{i + 1}</span>
                            {t?.logo_url ? <img src={t.logo_url} alt="" width={18} height={18} /> : <span />}
                            <span className="leader-n">{x.r.display_name}</span>
                            <b className="num">{ls.f(x.v)}</b>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {(up.length > 0 || down.length > 0) && (
            <section className="panel">
              <div className="hub-head"><h2>On the move</h2><span className="muted sm">this week</span></div>
              <div className="grid g2e" style={{ gap: 10 }}>
                <div>{up.map((x) => <Link key={x.r.team_id} to={`${base}/team/${x.r.team_id}`} className="leader-row"><span className="W">▲{x.d}</span>{x.r.logo_url ? <img src={x.r.logo_url} alt="" width={18} height={18} /> : <span />}<span className="leader-n">{x.r.short_name}</span><span className="muted sm">#{x.r.rank}</span></Link>)}</div>
                <div>{down.map((x) => <Link key={x.r.team_id} to={`${base}/team/${x.r.team_id}`} className="leader-row"><span className="L">▼{-x.d}</span>{x.r.logo_url ? <img src={x.r.logo_url} alt="" width={18} height={18} /> : <span />}<span className="leader-n">{x.r.short_name}</span><span className="muted sm">#{x.r.rank}</span></Link>)}</div>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="hub-head"><h2>Strongest conferences</h2><span className="muted sm">average team</span></div>
            {confList.map((c) => (
              <Link key={c.k} to={`${base}/conf/${c.best.conference_id}`} className="conf-bar">
                <span className="conf-n">{c.k}</span>
                <span className="conf-track"><span style={{ width: `${Math.max(4, (Math.abs(c.avg) / maxAvg) * 100)}%`, background: c.avg >= 0 ? visibleColor(c.best.color) : 'var(--rule)' }} /></span>
                <b className="num" style={{ color: c.avg >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(c.avg, 1)}</b>
              </Link>
            ))}
            <p className="muted sm" style={{ margin: '8px 0 0' }}>How many {meta.pointWord} per game the conference's average team beats an average team by.</p>
          </section>
        </div>
      </div>
    </>
  );
}
