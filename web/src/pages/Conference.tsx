import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Back, Loading, ErrorBox, TeamCell } from '../components/Shell';
import { predict, league, sign, perGame } from '../model';

// Conference race: current conference record plus projected finish from remaining conference games.
export function ConferencePage() {
  const { confId } = useParams();
  const cid = Number(confId);
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const nav = useNavigate();
  const members = useMemo(() => (R.data ?? []).filter((r) => r.conference_id === cid), [R.data, cid]);
  const ids = members.map((m) => m.team_id).join(',');
  const games = useAsync(() => ids ? restAll<Game>(`v_games?sport_id=eq.${sport}&season_year=eq.${season}&home_team_id=in.(${ids})&away_team_id=in.(${ids})&order=start_time.asc`) : Promise.resolve([] as Game[]), [ids, sport, season]);
  const L = useMemo(() => league(R.data ?? []), [R.data]);

  const table = useMemo(() => {
    const m = new Map(members.map((t) => [t.team_id, { t, w: 0, l: 0, pw: 0, left: 0 }]));
    for (const g of games.data ?? []) {
      const h = m.get(g.home_team_id), a = m.get(g.away_team_id);
      if (!h || !a) continue;
      if (g.completed && g.home_score != null) {
        if (g.home_score > g.away_score!) { h.w++; a.l++; } else { a.w++; h.l++; }
      } else {
        const p = predict(h.t, a.t, L, g.neutral_site ? 0 : 1, sport);
        h.pw += p.aWin; a.pw += 1 - p.aWin; h.left++; a.left++;
      }
    }
    return [...m.values()].map((x) => ({ ...x, projW: x.w + x.pw, projL: x.l + (x.left - x.pw) }))
      .sort((a, b) => b.projW - a.projW || b.t.adj_em - a.t.adj_em);
  }, [members, games.data, L, sport]);

  if (R.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;
  if (!members.length) return <><Back /><div className="panel empty">Conference not found for this season.</div></>;

  const name = members[0].conference_name;
  const avg = members.reduce((a, r) => a + perGame(r, sport).rating, 0) / members.length;
  const confRanks = [...new Set((R.data ?? []).map((r) => r.conference_id))].map((c) => {
    const ms = R.data!.filter((r) => r.conference_id === c); return { c, v: ms.reduce((a, r) => a + r.adj_em, 0) / ms.length };
  }).sort((a, b) => b.v - a.v);
  const confRank = confRanks.findIndex((x) => x.c === cid) + 1;
  const anyConfGames = (games.data ?? []).length > 0;

  return (
    <>
      <Back />
      <h1>{name}</h1>
      <p className="sub">{members.length} teams · average rating {sign(avg)} {meta.pointWord} per game · #{confRank} of {confRanks.length} conferences.
        {anyConfGames ? ' Projected finish counts games played plus the model\'s odds in every conference game left.' : ' Conference play hasn\'t been scheduled into the data yet, so this is ordered by rating.'}</p>
      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>#</th><th className="l">Team</th><th>Natl</th><th>Rating</th>{anyConfGames && <><th>Conf</th><th>Projected</th></>}<th className="hide-sm">Off / game</th><th className="hide-sm">Def / game</th></tr></thead>
            <tbody>
              {table.map((x, i) => (
                <tr key={x.t.team_id} className="row" onClick={() => nav(`${base}/team/${x.t.team_id}`)}>
                  <td className="rk">{i + 1}</td>
                  <td className="l"><TeamCell name={x.t.short_name} logo={x.t.logo_url} color={x.t.color} /></td>
                  <td className="num">{x.t.rank}</td>
                  <td className="num" style={{ color: x.t.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(perGame(x.t, sport).rating, 1)}</td>
                  {anyConfGames && <><td className="num">{x.w}-{x.l}</td><td className="num" style={{ fontSize: 18 }}>{x.projW.toFixed(1)}-{x.projL.toFixed(1)}</td></>}
                  <td className="hide-sm num">{perGame(x.t, sport).off.toFixed(1)}</td><td className="hide-sm num">{perGame(x.t, sport).def.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
