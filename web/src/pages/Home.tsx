import { Link } from 'react-router-dom';
import { rest, restAll, ratingsFor, type Game, type Rating } from '../api';
import { useAsync, useFollows } from '../hooks';
import { Loading, TeamCell } from '../components/Shell';
import { predict, league, perGame, sign, pct, outsider } from '../model';
import { sportMeta } from '../sports';
import { GameCard, YourTeams } from './Today';

// Which sports are playing this month (rough windows; the off-season ones drop to the bottom).
const SEASON_MONTHS: Record<string, number[]> = { mbb: [11, 12, 1, 2, 3, 4], wbb: [11, 12, 1, 2, 3, 4], cfb: [8, 9, 10, 11, 12, 1], bsb: [2, 3, 4, 5, 6], sb: [2, 3, 4, 5, 6] };
const ORDER = ['mbb', 'wbb', 'cfb', 'bsb', 'sb'];

// The front page: your teams, tonight's best games in every sport that's playing, each sport's top 10, the record.
export function HomePage() {
  const { list: follows } = useFollows();
  const month = new Date().getMonth() + 1;
  const live = ORDER.filter((s) => SEASON_MONTHS[s].includes(month));
  const off = ORDER.filter((s) => !live.includes(s));
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 864e5);

  // Everything for every live sport at once, in parallel.
  const data = useAsync(() => Promise.all(live.map(async (s) => {
    const season = sportMeta(s).seasons[0].year;
    const [rs, games] = await Promise.all([
      ratingsFor(s, season),
      restAll<Game>(`v_games?sport_id=eq.${s}&start_time=gte.${start.toISOString()}&start_time=lt.${end.toISOString()}&order=start_time.asc`),
    ]);
    return { s, season, rs, games };
  })), [live.join(',')]);
  const record = useAsync(() => rest<{ home_prob: number; games: { home_score: number | null; away_score: number | null; completed: boolean } | null }[]>(`predictions?select=home_prob,games(home_score,away_score,completed)&kind=eq.live&estimated=eq.false`), []);

  const watch: { s: string; season: number; card: JSX.Element; score: number }[] = [];
  for (const d of data.data ?? []) {
    const byId = new Map(d.rs.map((r) => [r.team_id, r])); const L = league(d.rs); const N = d.rs.length || 1;
    for (const g of d.games) {
      const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
      if (!H || !A || g.completed) continue;
      const pr = predict(H, A, L, g.neutral_site ? 0 : 1, d.s);
      const score = (1 - (H.rank + A.rank) / (2 * N)) * (0.45 + 0.55 * (1 - Math.abs(2 * pr.aWin - 1)));
      watch.push({ s: d.s, season: d.season, score, card: <GameCard key={g.id} g={g} H={H} A={A} est={false} pr={pr} final={false} homeWon={false} base={`/${d.s}/${d.season}`} /> });
    }
  }
  watch.sort((a, b) => b.score - a.score);
  const scored = (record.data ?? []).filter((r) => r.games?.completed && r.games.home_score != null && r.games.home_score !== r.games.away_score);
  const right = scored.filter((r) => (Number(r.home_prob) >= 0.5) === (r.games!.home_score! > r.games!.away_score!)).length;
  void outsider;

  return (
    <>
      <div className="homehead">
        <h1>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        <Link to="/record" className="recordpill">
          {scored.length ? <>Our picks: <b>{right}-{scored.length - right}</b> ({pct(right / scored.length)})</> : <>Picks are live: <b>{(record.data ?? []).length}</b> saved before tip</>}
        </Link>
      </div>

      <YourTeams follows={follows} />

      {data.loading ? <Loading rows={6} /> : (
        <>
          {watch.length > 0 && (
            <section style={{ marginBottom: 22 }}>
              <h2 className="h2s">Worth watching tonight</h2>
              <p className="muted sm" style={{ margin: '-6px 0 10px' }}>Good teams, close games, every sport that's playing.</p>
              <div className="games">{watch.slice(0, 6).map((w) => <div key={w.card.key} className="tagged"><span className="tag">{sportMeta(w.s).short}</span>{w.card}</div>)}</div>
            </section>
          )}

          <section>
            <h2 className="h2s">Top 10 right now</h2>
            <div className="grid tops">
              {(data.data ?? []).map((d) => <TopTen key={d.s} s={d.s} season={d.season} rs={d.rs} games={d.games.length} />)}
            </div>
          </section>
        </>
      )}

      {off.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 className="h2s">Off-season</h2>
          <div className="offs">
            {off.map((s) => <Link key={s} to={`/${s}/${sportMeta(s).seasons[0].year}`} className="sheet-row">{sportMeta(s).long}<span className="muted sm">last season's final ratings</span></Link>)}
          </div>
        </section>
      )}
    </>
  );
}

function TopTen({ s, season, rs, games }: { s: string; season: number; rs: Rating[]; games: number }) {
  const meta = sportMeta(s); const base = `/${s}/${season}`;
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{meta.long}</h3>
        <Link to={`${base}/today`} className="muted sm">{games ? `${games} games today` : 'Scores'} ›</Link>
      </div>
      <table className="tbl">
        <tbody>
          {rs.slice(0, 10).map((r) => (
            <tr key={r.team_id} className="row" onClick={() => { location.href = `${base}/team/${r.team_id}`; }}>
              <td className="rk" style={{ fontSize: 16 }}>{r.rank}</td>
              <td className="l"><Link to={`${base}/team/${r.team_id}`}><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></Link></td>
              <td className="num" style={{ color: r.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(perGame(r, s).rating, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link to={base} className="btn ghost" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>All {rs.length} teams</Link>
    </div>
  );
}
