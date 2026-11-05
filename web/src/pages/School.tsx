import { Link, useParams } from 'react-router-dom';
import { rest, num, type Rating } from '../api';
import { useAsync } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { perGame, sign } from '../model';
import { SPORTS, sportMeta } from '../sports';

interface Profile { sport_id: string; season_year: number; team_id: number; wins: number; losses: number }

// One school, every sport we rate: where it stands right now in each. ESPN uses the same team id for a school
// across sports, which is what ties them together.
export function SchoolPage() {
  const { espnId } = useParams();
  const data = useAsync(async () => {
    const rows = await rest<Rating[]>(`v_ratings_latest?team_espn_id=eq.${espnId}&order=sport_id.asc,season_year.desc`);
    // Latest season per sport, in the order the sports are listed.
    const latest = new Map<string, Rating>();
    for (const r of rows) if (!latest.has(r.sport_id)) latest.set(r.sport_id, { ...r, adj_off: num(r.adj_off), adj_def: num(r.adj_def), adj_em: num(r.adj_em), tempo: num(r.tempo) });
    const list = Object.keys(SPORTS).map((s) => latest.get(s)).filter(Boolean) as Rating[];
    const profiles = list.length ? await rest<Profile[]>(`mv_team_profile?or=(${list.map((r) => `and(sport_id.eq.${r.sport_id},season_year.eq.${r.season_year},team_id.eq.${r.team_id})`).join(',')})`) : [];
    const counts = await Promise.all(list.map((r) => rest<{ count: number }[]>(`v_ratings_latest?select=count&sport_id=eq.${r.sport_id}&season_year=eq.${r.season_year}`).then((x) => Number(x[0]?.count ?? 0))));
    return { list, profiles, counts };
  }, [espnId]);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error} />;
  const { list, profiles, counts } = data.data!;
  if (!list.length) return <><Back /><div className="panel empty">No rated teams for this school.</div></>;
  const head = list[0];
  const profFor = (r: Rating) => profiles.find((p) => p.sport_id === r.sport_id && p.season_year === r.season_year && p.team_id === r.team_id);
  // A simple overall: average of where each team sits, 0-100, across the sports it fields.
  const standing = list.map((r, i) => 100 * (1 - (r.rank - 1) / Math.max(1, counts[i] - 1)));
  const overall = Math.round(standing.reduce((a, b) => a + b, 0) / standing.length);

  return (
    <>
      <Back />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        {head.logo_url && <img src={head.logo_url} alt="" width={56} height={56} style={{ objectFit: 'contain' }} />}
        <div>
          <h1 style={{ margin: 0 }}>{head.short_name}</h1>
          <div className="muted">Every sport we rate, right now</div>
        </div>
      </div>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><div className="k">Sports rated</div><div className="v">{list.length}</div><div className="r">of {Object.keys(SPORTS).length} we cover</div></div>
        <div className="card"><div className="k">Overall standing</div><div className="v">{overall}</div><div className="r">average rank, out of 100, across those sports</div></div>
        <div className="card"><div className="k">Best</div><div className="v" style={{ fontSize: 24 }}>{sportMeta(list.reduce((b, r, i) => (standing[i] > standing[b] ? i : b), 0) === -1 ? 'mbb' : list[standing.indexOf(Math.max(...standing))].sport_id).short}</div><div className="r">#{Math.min(...list.map((r) => r.rank))} nationally</div></div>
      </div>
      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th className="l">Sport</th><th>Rank</th><th>Rating</th><th>Record</th><th className="hide-sm l">Conference</th></tr></thead>
            <tbody>
              {list.map((r, i) => {
                const p = profFor(r); const meta = sportMeta(r.sport_id);
                return (
                  <tr key={r.sport_id} className="row">
                    <td className="l"><Link to={`/${r.sport_id}/${r.season_year}/team/${r.team_id}`}><b>{meta.long}</b> <span className="muted sm">{meta.seasons.find((x) => x.year === r.season_year)?.label ?? r.season_year}</span></Link></td>
                    <td className="num big">#{r.rank}<span className="muted sm hide-sm"> of {counts[i]}</span></td>
                    <td className="num" style={{ color: r.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(perGame(r, r.sport_id).rating, meta.hoops ? 1 : 1)}</td>
                    <td className="num">{p ? `${p.wins}-${p.losses}` : '–'}</td>
                    <td className="hide-sm l muted">{r.conference_short}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted sm" style={{ margin: '10px 0 0' }}>Rating is {list[0] ? 'points or runs' : ''} per game better than an average team in that sport. Tap a sport for the full team page.</p>
      </div>
    </>
  );
}
