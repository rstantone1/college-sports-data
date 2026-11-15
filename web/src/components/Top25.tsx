import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Loading, ErrorBox, TeamCell } from './Shell';
import { buildPack } from '../playoff/pack';
import { COMMITTEE, resume } from '../playoff/config';
import { buildBracketPack } from '../bracket/pack';

// The Top 25: who has earned it. Wins and losses weighed by who they came against, with a share for how good the
// team is. Power ratings (the other view) rank how good a team is, whatever its record.
const COLS = 'id,espn_id,season_type,start_time,status,completed,neutral_site,home_team_id,away_team_id,home_score,away_score,notes';
export const hasTop25 = (sport: string) => sport === 'cfb' || sport === 'mbb' || sport === 'wbb';
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function Top25() {
  const { sport, season, base, meta } = useCtx(); const R = useRatings(); const nav = useNavigate();
  const G = useAsync(() => restAll<Game>(`v_games?sport_id=eq.${sport}&season_year=eq.${season}&select=${COLS}&order=start_time`), [sport, season]);
  const rows = useMemo(() => {
    if (!R.data?.length || !G.data) return [];
    const byId = new Map(R.data.map((r) => [r.team_id, r]));
    const scored = sport === 'cfb'
      ? buildPack(season, R.data, G.data, null, []).teams.map((t) => ({ id: t.id, w: t.w, l: t.l, power: t.ourRank, s: resume(COMMITTEE.beta, t) }))
      : (() => { const p = buildBracketPack(sport, season, R.data!, G.data!); return p.teams.map((t) => ({ id: t.id, w: t.w, l: t.l, power: t.ourRank, s: t.wab + Math.max(0.4, p.format.powerWeight) * (t.pr / 10) })); })();
    return scored.filter((t) => t.w + t.l > 0 && byId.has(t.id)).sort((a, b) => b.s - a.s).slice(0, 25).map((t, i) => ({ ...t, rank: i + 1, r: byId.get(t.id)! }));
  }, [R.data, G.data, sport, season]);
  if (R.loading || G.loading) return <Loading rows={12} />;
  if (R.error || G.error) return <ErrorBox msg={(R.error || G.error)!} />;
  if (!rows.length) return <div className="panel empty"><p>The Top 25 starts once games have been played.</p></div>;
  const few = rows.reduce((a, t) => a + t.w + t.l, 0) / rows.length < 5;
  return (
    <>
      <p className="sub">The 25 teams that have earned it most: wins and losses, weighed by who they came against. {few && <><b>Early season:</b> with only a few games played, this will move a lot week to week. </>}For who is simply the best team, see Power ratings.</p>
      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>#</th><th className="l">Team</th><th>Record</th><th>Power rating</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="row" onClick={() => nav(`${base}/team/${t.id}`)}>
                  <td className="rk">{t.rank}</td>
                  <td className="l"><TeamCell name={t.r.short_name} logo={t.r.logo_url} color={t.r.color} /></td>
                  <td className="num big">{t.w}-{t.l}</td>
                  <td className="num">{ord(t.power)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted sm" style={{ margin: '10px 0 0' }}>Power rating is where the team ranks on how good it is, by {meta.pointWord} scored and allowed against the schedule it played. A team can rate higher there than its record has earned here, and the other way around.</p>
      </div>
    </>
  );
}
