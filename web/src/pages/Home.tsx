import { Link } from 'react-router-dom';
import { rest, restAll, ratingsFor, type Game, type Rating } from '../api';
import { useAsync, useFollows, fmtTime, fmtDate } from '../hooks';
import { Loading, TeamCell } from '../components/Shell';
import { predict, league, perGame, sign, pct, ovr } from '../model';
import { onColor, distinctPair } from '../hooks';
import { SPORTS, sportMeta } from '../sports';
import { GameCard, YourTeams } from './Today';
import { SinceLastVisit } from '../components/Since';
import { toBet, type Bet } from '../api';
import { betText, TIER } from '../components/Lines';

// Rough playing windows, by month. Off-season sports drop to the bottom with their opening month.
const SEASON_MONTHS: Record<string, number[]> = { mbb: [11, 12, 1, 2, 3, 4], wbb: [11, 12, 1, 2, 3, 4], cfb: [8, 9, 10, 11, 12, 1], bsb: [2, 3, 4, 5, 6], sb: [2, 3, 4, 5, 6] };
const OPENS: Record<string, string> = { mbb: 'November', wbb: 'November', cfb: 'August', bsb: 'February', sb: 'February' };
const ORDER = ['mbb', 'wbb', 'cfb', 'bsb', 'sb'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const chance = (p: number) => { const n = Math.round(1 / p); return p >= 0.5 ? pct(p) : n <= 10 ? `1 in ${n}` : pct(p); };

interface SportDay { s: string; season: number; rs: Rating[]; today: Game[]; yesterday: Game[]; before: Map<number, number>; since: string | null }

export function HomePage() {
  const { list: follows } = useFollows();
  const month = new Date().getMonth() + 1;
  const live = ORDER.filter((s) => SEASON_MONTHS[s].includes(month));
  const off = ORDER.filter((s) => !live.includes(s));
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const t1 = new Date(t0.getTime() + 864e5), y0 = new Date(t0.getTime() - 864e5);

  const data = useAsync(() => Promise.all(live.map(async (s): Promise<SportDay> => {
    const season = sportMeta(s).seasons[0].year;
    const weekAgo = ymd(new Date(Date.now() - 7 * 864e5));
    const [rs, today, yesterday, snap] = await Promise.all([
      ratingsFor(s, season),
      restAll<Game>(`v_games?sport_id=eq.${s}&start_time=gte.${t0.toISOString()}&start_time=lt.${t1.toISOString()}&order=start_time.asc`),
      restAll<Game>(`v_games?sport_id=eq.${s}&start_time=gte.${y0.toISOString()}&start_time=lt.${t0.toISOString()}&completed=eq.true`),
      // Rankings about a week ago (or the earliest we have this season), for "on the move".
      rest<{ as_of: string }[]>(`ratings?select=as_of&sport_id=eq.${s}&season_year=eq.${season}&as_of=lte.${weekAgo}&order=as_of.desc&limit=1`)
        .then((d) => d[0] ? d : rest<{ as_of: string }[]>(`ratings?select=as_of&sport_id=eq.${s}&season_year=eq.${season}&order=as_of.asc&limit=1`)),
    ]);
    let before = new Map<number, number>(), since: string | null = null;
    if (snap[0] && snap[0].as_of !== rs[0]?.as_of) {
      since = snap[0].as_of;
      const rows = await restAll<{ team_id: number; rank: number }>(`ratings?select=team_id,rank&sport_id=eq.${s}&season_year=eq.${season}&as_of=eq.${since}`);
      before = new Map(rows.map((r) => [r.team_id, r.rank]));
    }
    return { s, season, rs, today, yesterday, before, since };
  })), [live.join(',')]);
  const bets = useAsync(() => rest<any[]>(`v_bets?kind=eq.live&completed=eq.false&tier=in.(best,strong)&start_time=gte.${new Date(Date.now() - 3 * 3600e3).toISOString()}&order=start_time.asc&limit=4`).then((r) => r.map(toBet)), []);
  const record = useAsync(() => rest<{ home_prob: number; games: { home_score: number | null; away_score: number | null; completed: boolean } | null }[]>(`predictions?select=home_prob,games(home_score,away_score,completed)&kind=eq.live&estimated=eq.false`), []);

  // Pull tonight's games, last night's results and the week's movers out of every live sport.
  const watch: { s: string; key: number; el: JSX.Element; score: number; start: number }[] = [];
  let featured: { s: string; season: number; g: Game; H: Rating; A: Rating; pr: ReturnType<typeof predict>; all: Rating[]; score: number } | null = null;
  const upsetWatch: { s: string; season: number; g: Game; fav: Rating; dog: Rating; p: number }[] = [];
  const results: { s: string; season: number; g: Game; winner: Rating; loser: Rating; p: number }[] = [];
  let lastRight = 0, lastCalled = 0;
  for (const d of data.data ?? []) {
    const byId = new Map(d.rs.map((r) => [r.team_id, r])); const L = league(d.rs); const N = d.rs.length || 1; const base = `/${d.s}/${d.season}`;
    for (const g of d.today) {
      const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
      if (!H || !A) continue;
      const pr = predict(H, A, L, g.neutral_site ? 0 : 1, d.s);
      const final = g.completed && g.home_score != null;
      // Quality counts most (two top-20 teams beat a coin-flip between middling ones), then closeness.
      const q = 1 - (H.rank + A.rank) / (2 * N);
      const score = q * q * (0.6 + 0.4 * (1 - Math.abs(2 * pr.aWin - 1)));
      if (!final && (!featured || score > featured.score)) featured = { s: d.s, season: d.season, g, H, A, pr, all: d.rs, score };
      watch.push({ s: d.s, key: g.id, score, start: new Date(g.start_time).getTime(), el: <GameCard g={g} H={H} A={A} est={false} pr={pr} final={final} homeWon={final && g.home_score! > g.away_score!} base={base} /> });
      const favHome = pr.aWin >= 0.5, fav = favHome ? H : A, dog = favHome ? A : H, pDog = favHome ? 1 - pr.aWin : pr.aWin;
      if (!final && fav.rank <= Math.max(25, N * 0.08) && pDog >= 0.25) upsetWatch.push({ s: d.s, season: d.season, g, fav, dog, p: pDog });
    }
    for (const g of d.yesterday) {
      const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
      if (!H || !A || g.home_score == null || g.home_score === g.away_score) continue;
      const pr = predict(H, A, L, g.neutral_site ? 0 : 1, d.s);
      const homeWon = g.home_score > g.away_score!;
      lastCalled++; if ((pr.aWin >= 0.5) === homeWon) lastRight++;
      results.push({ s: d.s, season: d.season, g, winner: homeWon ? H : A, loser: homeWon ? A : H, p: homeWon ? pr.aWin : 1 - pr.aWin });
    }
  }
  watch.sort((a, b) => b.score - a.score);
  upsetWatch.sort((a, b) => b.p - a.p);
  const upsets = results.filter((r) => r.p < 0.35).sort((a, b) => a.p - b.p);

  const scored = (record.data ?? []).filter((r) => r.games?.completed && r.games.home_score != null && r.games.home_score !== r.games.away_score);
  const right = scored.filter((r) => (Number(r.home_prob) >= 0.5) === (r.games!.home_score! > r.games!.away_score!)).length;

  return (
    <>
      <div className="homehead">
        <div className="muted" style={{ fontWeight: 700 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <Link to="/record" className="recordpill">
          {scored.length ? <>Our picks: <b>{right}-{scored.length - right}</b> ({pct(right / scored.length)}) ›</> : <>We pick every game. See how we do ›</>}
        </Link>
      </div>

      {featured && <Featured f={featured} />}

      <nav className="sportrow" aria-label="Sports">
        {ORDER.map((s) => {
          const m = sportMeta(s); const on = live.includes(s); const d = data.data?.find((x) => x.s === s);
          return (
            <Link key={s} to={`/${s}/${m.seasons[0].year}/today`} className={`sporttile ${on ? '' : 'off'}`}>
              <b>{m.short}</b>
              <span>{on ? (d ? (d.today.length ? `${d.today.length} games today` : 'No games today') : '…') : `Starts in ${OPENS[s]}`}</span>
            </Link>
          );
        })}
      </nav>

      <SinceLastVisit follows={follows} />
      <YourTeams follows={follows} />
      {(bets.data?.length ?? 0) > 0 && <BestBets bets={bets.data!} />}

      {data.loading ? <Loading rows={6} /> : (
        <>
          {watch.length > 0 && (
            <section className="hsec">
              <h2>Best games today</h2>
              <p className="muted sm hsub">The best teams in the closest games, across every sport playing today.</p>
              <div className="games">{watch.slice(0, 6).map((w) => <div key={w.key} className="tagged"><span className="tag">{sportMeta(w.s).short}</span>{w.el}</div>)}</div>
            </section>
          )}

          {upsetWatch.length > 0 && (
            <section className="hsec">
              <h2>Upset watch</h2>
              <p className="muted sm hsub">Top teams with a real chance of losing today.</p>
              <div className="cards2">
                {upsetWatch.slice(0, 4).map((u) => (
                  <Link key={u.g.id} to={`/${u.s}/${u.season}/game/${u.g.id}`} className="panel upset">
                    <div className="muted sm">{sportMeta(u.s).short} · {u.g.completed ? 'Final' : fmtTime(u.g.start_time)}</div>
                    <div className="upset-line"><b>{u.dog.short_name}</b> beats <b>#{u.fav.rank} {u.fav.short_name}</b></div>
                    <div className="upset-p">{chance(u.p)} <span className="muted sm">chance ({pct(u.p)})</span></div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.length > 0 && (
            <section className="hsec">
              <h2>Last night</h2>
              <p className="muted sm hsub">We called {lastRight} of {lastCalled} winners ({pct(lastRight / Math.max(1, lastCalled))}).{upsets.length ? ' Biggest surprises:' : ''}</p>
              {upsets.length > 0 && (
                <div className="cards2">
                  {upsets.slice(0, 4).map((u) => {
                    const home = u.g.home_team_id === u.winner.team_id;
                    const ws = home ? u.g.home_score : u.g.away_score, ls = home ? u.g.away_score : u.g.home_score;
                    return (
                      <Link key={u.g.id} to={`/${u.s}/${u.season}/game/${u.g.id}`} className="panel upset">
                        <div className="muted sm">{sportMeta(u.s).short}</div>
                        <div className="upset-line"><b>{u.winner.short_name}</b> beat <b>#{u.loser.rank} {u.loser.short_name}</b> {ws}-{ls}</div>
                        <div className="muted sm">We gave them a {chance(u.p)} chance.</div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="hsec">
            <h2>Top 10 right now</h2>
            <div className="grid tops">{(data.data ?? []).map((d) => <TopTen key={d.s} d={d} />)}</div>
          </section>

          <Movers days={data.data ?? []} />
        </>
      )}

      <section className="hsec">
        <h2>Explore</h2>
        <div className="explore">
          <Link to="/record" className="panel"><b>How good are our picks?</b><span className="muted sm">Every pick we've made, and how often we were right.</span></Link>
          <Link to={`/mbb/${SPORTS.mbb.seasons[0].year}/matchup`} className="panel"><b>Matchup machine</b><span className="muted sm">Any two teams, any court: who wins and by how much.</span></Link>
          <Link to={`/mbb/${SPORTS.mbb.seasons[0].year}/transfers`} className="panel"><b>Transfer tracker</b><span className="muted sm">Every player who switched schools, and what they did before.</span></Link>
          <Link to="/about" className="panel"><b>How the ratings work</b><span className="muted sm">In plain English, in two minutes.</span></Link>
        </div>
      </section>

      {off.length > 0 && <p className="muted sm" style={{ marginTop: 18 }}>Out of season: {off.map((s) => <Link key={s} to={`/${s}/${sportMeta(s).seasons[0].year}`} style={{ textDecoration: 'underline', marginRight: 10 }}>{sportMeta(s).long} (last season's final rankings)</Link>)}</p>}
    </>
  );
}

function TopTen({ d }: { d: SportDay }) {
  const meta = sportMeta(d.s); const base = `/${d.s}/${d.season}`;
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{meta.long}</h3>
        <span className="muted sm">overall</span>
      </div>
      <table className="tbl">
        <tbody>
          {d.rs.slice(0, 10).map((r) => {
            const was = d.before.get(r.team_id); const mv = was ? was - r.rank : 0;
            return (
              <tr key={r.team_id}>
                <td className="rk" style={{ fontSize: 16 }}>{r.rank}{mv !== 0 && <span className={`mv ${mv > 0 ? 'up' : 'dn'}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</span>}</td>
                <td className="l"><Link to={`${base}/team/${r.team_id}`}><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></Link></td>
                <td className="num"><span className="ovr">{ovr(d.rs, r).ovr}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Link to={`${base}/rankings`} className="btn ghost" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>All {d.rs.length} teams</Link>
    </div>
  );
}

// Biggest climbs and drops among teams that matter (top 100 now or before).
function Movers({ days }: { days: SportDay[] }) {
  const rows = days.filter((d) => d.since).map((d) => {
    const ms = d.rs.map((r) => ({ r, was: d.before.get(r.team_id) })).filter((x) => x.was && (x.r.rank <= 100 || x.was <= 100)).map((x) => ({ ...x, mv: x.was! - x.r.rank }));
    return { d, up: [...ms].sort((a, b) => b.mv - a.mv).slice(0, 3).filter((x) => x.mv > 0), down: [...ms].sort((a, b) => a.mv - b.mv).slice(0, 3).filter((x) => x.mv < 0) };
  }).filter((x) => x.up.length || x.down.length);
  if (!rows.length) return null;
  return (
    <section className="hsec">
      <h2>On the move</h2>
      <p className="muted sm hsub">Biggest climbs and drops in the rankings this week.</p>
      <div className="grid tops">
        {rows.map(({ d, up, down }) => (
          <div key={d.s} className="panel">
            <h3 style={{ margin: '0 0 4px' }}>{sportMeta(d.s).long} <span className="muted sm">since {fmtDate(d.since! + 'T12:00:00')}</span></h3>
            {[...up, ...down].map((x) => (
              <Link key={x.r.team_id} to={`/${d.s}/${d.season}/team/${x.r.team_id}`} className="mover">
                <span className={`mv ${x.mv > 0 ? 'up' : 'dn'}`}>{x.mv > 0 ? '▲' : '▼'}{Math.abs(x.mv)}</span>
                <b>{x.r.short_name}</b>
                <span className="muted sm">#{x.was} → #{x.r.rank}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// The game of the day, presented like a video game matchup screen: both teams in their colors, overall ratings,
// win chances and the likely score.
function Featured({ f }: { f: { s: string; season: number; g: Game; H: Rating; A: Rating; pr: ReturnType<typeof predict>; all: Rating[] } }) {
  const { g, H, A, pr, all } = f;
  const [ca, cb] = distinctPair(A.color, H.color, H.alt_color);
  const side = (r: Rating, c: string, p: number, pts: number, label: string) => {
    const o = ovr(all, r);
    return (
      <div className="fside" style={{ background: c, color: onColor(c) }}>
        <div className="fmeta">{label}</div>
        {r.logo_url && <img src={r.logo_url} alt="" />}
        <div className="fname">{r.short_name}</div>
        <div className="frank">#{r.rank} · {r.conference_short}</div>
        <div className="fovr"><span><b>{o.ovr}</b>OVR</span><span><b>{o.off}</b>OFF</span><span><b>{o.def}</b>DEF</span></div>
        <div className="fpct">{pct(p)}</div>
        <div className="fpts">{Math.round(pts)}</div>
      </div>
    );
  };
  return (
    <Link to={`/${f.s}/${f.season}/game/${g.id}`} className="featured">
      <div className="ftop"><span>Game of the day · {sportMeta(f.s).long}</span><span>{fmtTime(g.start_time)}{g.neutral_site ? ` · neutral ${sportMeta(f.s).venue}` : ''}</span></div>
      <div className="fbody">
        {side(A, ca, 1 - pr.aWin, pr.bPts, g.neutral_site ? '' : 'Away')}
        <div className="fvs">VS</div>
        {side(H, cb, pr.aWin, pr.aPts, g.neutral_site ? '' : 'Home')}
      </div>
      <div className="fbar"><div style={{ width: `${(1 - pr.aWin) * 100}%`, background: ca }} /><div style={{ width: `${pr.aWin * 100}%`, background: cb }} /></div>
      <div className="fbot">Our pick: <b>{pr.aWin >= 0.5 ? H.short_name : A.short_name}</b> by {Math.max(1, Math.round(Math.abs(pr.margin)))}. Big number is the likely final score.</div>
    </Link>
  );
}

// The day's best bets, when there are any. The full list, reasons and record live on the Best bets page.
function BestBets({ bets }: { bets: Bet[] }) {
  return (
    <section className="hsec">
      <h2>Best bets</h2>
      <p className="muted sm hsub">Where our number and the sportsbooks disagree most. <Link to="/bets" style={{ color: 'var(--cool)' }}>All bets and our record ›</Link></p>
      <div className="betlist">
        {bets.map((b) => (
          <Link key={b.id} to={`/${b.sport_id}/${b.season_year}/game/${b.game_id}`} className="panel betcard">
            <div className="bc-top"><span className="pill">{sportMeta(b.sport_id).short}</span><span className="muted sm">{fmtDate(b.start_time, { weekday: 'short' })} {fmtTime(b.start_time)}</span>{b.tier && <span className={TIER[b.tier].cls} style={{ marginLeft: 'auto' }}>{TIER[b.tier].label}</span>}</div>
            <div className="bc-pick">{betText(b, b.home_name, b.away_name)}</div>
            <div className="muted sm">{b.away_name} {b.neutral_site ? 'vs' : 'at'} {b.home_name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
