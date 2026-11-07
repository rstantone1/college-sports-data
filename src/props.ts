// Player projections for upcoming games (basketball): the groundwork for player props. Minutes come from recent
// games; per-minute rates from the season with last season as a prior; then pace and the opponent. Backtested on
// 2024-26: points miss by 4.7 a game (about 1% better than a season average, which is close to the noise floor
// for single games). Comparing these with books' prop lines needs a props feed; until then they're shown as
// projections only.
import { q } from './db.js';
import type { SportConfig } from './sports.js';

export const PROPS_VERSION = 'props-v1';
const STATS = ['points', 'rebounds', 'assists', 'threePointFieldGoalsMade'] as const;
const HL = 8, HLM = 3, PRIOR_G = 6, ALPHA = 0.7;
const decay = (hl: number) => Math.pow(0.5, 1 / hl);

export async function writeProjections(s: SportConfig, season: number) {
  if (s.id !== 'mbb' && s.id !== 'wbb') return;
  const games = await q<{ id: number; h: number; a: number }>(
    `select g.id, g.home_team_id h, g.away_team_id a from games g
     where g.sport_id=$1 and g.season_year=$2 and not g.completed and g.start_time > now() and g.start_time < now() + interval '36 hours'
       and g.home_team_id is not null and g.away_team_id is not null
       and not exists (select 1 from player_projections p where p.game_id=g.id and p.kind='live')`, [s.id, season]);
  if (!games.length) { console.log(`${s.id}: no new games to project`); return; }
  const teamIds = [...new Set(games.flatMap((g) => [Number(g.h), Number(g.a)]))];
  // This season's player lines for the teams playing, oldest first.
  const logs = await q<{ p: number; tm: number; x: Record<string, any> }>(
    `select ps.player_id p, ps.team_id tm, ps.stats x from game_player_stats ps join games g on g.id=ps.game_id
     where g.sport_id=$1 and g.season_year=$2 and g.completed and ps.team_id = any($3::bigint[]) and not ps.did_not_play
     order by g.start_time`, [s.id, season, teamIds]);
  // Last season's per-minute rates, as a prior for players with few games.
  const players = [...new Set(logs.map((l) => Number(l.p)))];
  const prev = await q<any>(
    `select ps.player_id p, sum((ps.stats->>'minutes')::numeric) m, ${STATS.map((k) => `sum(coalesce((ps.stats->>'${k}')::numeric,0)) "${k}"`).join(', ')}
     from game_player_stats ps join games g on g.id=ps.game_id
     where g.sport_id=$1 and g.season_year=$2 and g.completed and ps.player_id = any($3::bigint[]) and not ps.did_not_play group by 1`, [s.id, season - 1, players]);
  const prior = new Map(prev.map((r) => [Number(r.p), r]));
  // Pace and what each team allows per possession, this season.
  const teamRows = await q<any>(
    `select ts.team_id tm, ts.stats x, os.stats ox from game_team_stats ts join games g on g.id=ts.game_id
     join game_team_stats os on os.game_id=ts.game_id and os.team_id<>ts.team_id
     where g.sport_id=$1 and g.season_year=$2 and g.completed`, [s.id, season]);
  const poss = (x: any) => (Number(x?.fieldGoalsAttempted) || 0) - (Number(x?.offensiveRebounds) || 0) + (Number(x?.totalTurnovers ?? x?.turnovers) || 0) + 0.475 * (Number(x?.freeThrowsAttempted) || 0);
  const team = new Map<number, { poss: number; n: number; allow: Record<string, number> }>();
  let lgPoss = 0, lgN = 0; const lgAllow: Record<string, number> = { points: 0, rebounds: 0, assists: 0, threePointFieldGoalsMade: 0 };
  const statOf = (x: any, k: string) => (k === 'points' ? null : k === 'rebounds' ? Number(x?.totalRebounds) : k === 'assists' ? Number(x?.assists) : Number(x?.threePointFieldGoalsMade));
  for (const r of teamRows) {
    const tm = Number(r.tm); const p = (poss(r.x) + poss(r.ox)) / 2; if (!(p > 30)) continue;
    const t = team.get(tm) ?? { poss: 0, n: 0, allow: { points: 0, rebounds: 0, assists: 0, threePointFieldGoalsMade: 0 } };
    t.poss += p; t.n++;
    const oppPts = (Number(r.ox?.fieldGoalsMade) || 0) * 2 + (Number(r.ox?.threePointFieldGoalsMade) || 0) + (Number(r.ox?.freeThrowsMade) || 0);
    for (const k of STATS) { const v = (k === 'points' ? oppPts : statOf(r.ox, k) ?? 0) / p; t.allow[k] += v; lgAllow[k] += v; }
    team.set(tm, t); lgPoss += p; lgN++;
  }
  const lgP = lgN ? lgPoss / lgN : 68;
  // Player state from this season's games.
  interface St { gp: number; minW: number; minSum: number; rate: Record<string, { s: number; m: number }>; sum: Record<string, number>; tm: number }
  const P = new Map<number, St>();
  for (const l of logs) {
    const min = Number(l.x?.minutes); if (!(min > 0)) continue;
    const p = Number(l.p);
    let st = P.get(p);
    if (!st) {
      const pr = prior.get(p); const pm = pr ? Number(pr.m) : 0;
      st = { gp: 0, minW: min, minSum: 0, rate: {}, sum: {}, tm: Number(l.tm) };
      for (const k of STATS) { st.rate[k] = pr && pm > 0 ? { s: (Number(pr[k]) / pm) * 30 * PRIOR_G, m: 30 * PRIOR_G } : { s: 0, m: 0 }; st.sum[k] = 0; }
      P.set(p, st);
    }
    st.minW = st.gp ? st.minW * decay(HLM) + min * (1 - decay(HLM)) : min;
    st.gp++; st.minSum += min; st.tm = Number(l.tm);
    for (const k of STATS) { const v = Number(l.x?.[k]) || 0; st.rate[k].s = st.rate[k].s * decay(HL) + v; st.rate[k].m = st.rate[k].m * decay(HL) + min; st.sum[k] += v; }
  }
  let n = 0;
  const rows: [number, number, number, string, number, number][] = [];
  for (const g of games) {
    for (const [tm, opp] of [[Number(g.h), Number(g.a)], [Number(g.a), Number(g.h)]]) {
      const T = team.get(tm), O = team.get(opp);
      const tPace = T && T.n ? T.poss / T.n : lgP, oPace = O && O.n ? O.poss / O.n : lgP;
      const paceF = (tPace * oPace) / lgP / tPace;
      for (const [p, st] of P) {
        if (st.tm !== tm || st.gp < 3) continue;
        const avgMin = st.minSum / st.gp;
        if (avgMin < 10) continue;
        for (const k of STATS) {
          const perMin = st.rate[k].m ? st.rate[k].s / st.rate[k].m : 0;
          const oppF = O && O.n && lgN ? Math.max(0.7, Math.min(1.3, (O.allow[k] / O.n) / (lgAllow[k] / lgN))) : 1;
          const oppShrunk = 1 + (oppF - 1) * Math.min(1, (O?.n ?? 0) / 8) * 0.6;
          const raw = st.minW * perMin * paceF * oppShrunk;
          const proj = ALPHA * raw + (1 - ALPHA) * (st.sum[k] / st.gp);
          rows.push([Number(g.id), p, tm, k, Math.round(proj * 10) / 10, Math.round(st.minW * 10) / 10]);
        }
        n++;
      }
    }
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const c = rows.slice(i, i + 1000);
    await q(
      `insert into player_projections(game_id, player_id, team_id, kind, stat, projection, minutes, model_version)
       select g, p, t, 'live', k, v, m, $7 from unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::text[], $5::numeric[], $6::numeric[]) as x(g, p, t, k, v, m)
       on conflict do nothing`,
      [c.map((r) => r[0]), c.map((r) => r[1]), c.map((r) => r[2]), c.map((r) => r[3]), c.map((r) => r[4]), c.map((r) => r[5]), PROPS_VERSION]);
  }
  console.log(`${s.id} ${season}: projections for ${n} players in ${games.length} games`);
}
