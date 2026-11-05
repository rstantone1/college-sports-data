import { Link } from 'react-router-dom';
import { restAll, type Game, type Rating } from '../api';
import { useAsync, useCtx, percentile, fmtDate } from '../hooks';
import { Loading } from './Shell';
import { Bars, type BarRow } from './Bars';
import { perGame, sign, predict, league } from '../model';

export interface Profile {
  sport_id: string; season_year: number; team_id: number; gp: number; wins: number; losses: number;
  home_w: number; home_l: number; road_w: number; road_l: number; neutral_w: number; neutral_l: number; d1_gp: number; d1_wins: number;
  last10_w: number | null; last10_l: number | null; luck: number | null; sos: number | null; nc_sos: number | null; q1_gp: number | null; q1_w: number | null;
  efg: number | null; tov_pct: number | null; orb_pct: number | null; ftr: number | null; d_efg: number | null; d_tov_pct: number | null; drb_pct: number | null; d_ftr: number | null;
  tpa_rate: number | null; tp_pct: number | null; d_tp_pct: number | null; ft_pct: number | null; ast_rate: number | null;
  ypp: number | null; d_ypp: number | null; ypr: number | null; ypa: number | null; to_pg: number | null; d_to_pg: number | null;
  avg: number | null; obp: number | null; k_rate: number | null; bb_rate: number | null; era: number | null; whip: number | null; k9: number | null; d_avg: number | null;
}

export function useProfiles(sport: string, season: number) {
  return useAsync(() => restAll<Profile>(`mv_team_profile?sport_id=eq.${sport}&season_year=eq.${season}`).then((rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null || typeof v === 'string' && k !== 'sport_id' ? (v == null ? null : Number(v)) : v])) as Profile)), [sport, season]);
}

const P = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const F = (v: number | null, d = 1) => (v == null ? '–' : v.toFixed(d));

// What a team is good and bad at, each stat as where it ranks among every team in the sport this season.
export function ProfileBars({ me, all, ratings }: { me: Profile; all: Profile[]; ratings: Rating[] }) {
  const { sport, meta } = useCtx();
  const myR = ratings.find((r) => r.team_id === me.team_id);
  const col = <K extends keyof Profile>(k: K) => all.map((p) => p[k] as number);
  const row = (label: string, k: keyof Profile, fmt: (v: number | null) => string, higher = true, note?: string): BarRow =>
    ({ label, value: fmt(me[k] as number | null), pct: percentile(col(k), me[k] as number, higher), note });
  const pg = (r: Rating) => perGame(r, sport);
  const core: BarRow[] = myR ? [
    { label: 'Offense', value: F(pg(myR).off), pct: percentile(ratings.map((r) => pg(r).off), pg(myR).off), note: `${meta.pointWord} per game vs an average defense` },
    { label: 'Defense', value: F(pg(myR).def), pct: percentile(ratings.map((r) => pg(r).def), pg(myR).def, false), note: `${meta.pointWord} allowed per game vs an average offense` },
    ...(meta.hoops ? [{ label: 'Pace', value: F(myR.tempo), pct: percentile(ratings.map((r) => r.tempo), myR.tempo), note: 'possessions per game (not good or bad, just style)' }] : []),
    row('Schedule', 'sos', (v) => sign(v ?? 0), true, 'average rating of opponents played; higher = tougher'),
    row('Luck', 'luck', (v) => sign(v ?? 0), true, 'wins above what the scoring margins say; lucky teams tend to come back down'),
  ] : [];
  const hoops: BarRow[] = meta.hoops ? [
    row('Shooting', 'efg', P, true, 'effective field goal %: threes count 1.5'),
    row('Ball security', 'tov_pct', P, false, 'turnovers per possession; lower is better'),
    row('Off. rebounding', 'orb_pct', P, true, 'share of own misses rebounded'),
    row('Getting to the line', 'ftr', P, true, 'free throw attempts per shot'),
    row('3-point rate', 'tpa_rate', P, true, 'share of shots from three (style)'),
    row('3-point %', 'tp_pct', P),
    row('Free throw %', 'ft_pct', P),
  ] : sport === 'cfb' ? [
    row('Yards per play', 'ypp', (v) => F(v, 2)),
    row('Rushing yds/att', 'ypr', (v) => F(v, 2)),
    row('Passing yds/att', 'ypa', (v) => F(v, 2)),
    row('Turnovers / game', 'to_pg', (v) => F(v, 2), false),
  ] : [
    row('Batting average', 'avg', (v) => (v == null ? '–' : v.toFixed(3).replace(/^0/, ''))),
    row('On-base %', 'obp', (v) => (v == null ? '–' : v.toFixed(3).replace(/^0/, ''))),
    row('Walk rate', 'bb_rate', P),
    row('Strikeout rate', 'k_rate', P, false, 'batters striking out; lower is better'),
  ];
  const defense: BarRow[] = meta.hoops ? [
    row('Opp. shooting', 'd_efg', P, false, 'what opponents shoot; lower is better'),
    row('Forcing turnovers', 'd_tov_pct', P, true),
    row('Def. rebounding', 'drb_pct', P, true, 'share of opponent misses rebounded'),
    row('Keeping them off the line', 'd_ftr', P, false),
    row('Opp. 3-point %', 'd_tp_pct', P, false),
  ] : sport === 'cfb' ? [
    row('Opp. yards per play', 'd_ypp', (v) => F(v, 2), false),
    row('Takeaways / game', 'd_to_pg', (v) => F(v, 2), true),
  ] : [
    row('ERA', 'era', (v) => F(v, 2), false),
    row('WHIP', 'whip', (v) => F(v, 3), false, 'baserunners allowed per inning; lower is better'),
    row('Strikeouts per 9', 'k9', (v) => F(v, 2)),
    row('Opp. batting avg', 'd_avg', (v) => (v == null ? '–' : v.toFixed(3).replace(/^0/, '')), false),
  ];
  return (
    <div className="grid" style={{ gap: 14 }}>
      <Bars title="The big picture" rows={core} hint="compared with every team" />
      <Bars title={meta.hoops ? 'Offense: the four things that win' : sport === 'cfb' ? 'Offense' : 'Hitting'} rows={hoops} />
      <Bars title={meta.hoops ? 'Defense' : sport === 'cfb' ? 'Defense' : 'Pitching'} rows={defense} />
    </div>
  );
}

interface Impact { game_id: number; game_adj_em: number; contrib: number }

// The games that moved the rating most, in plain words: what we expected going in, what happened, and how much it
// changed the rating. A blowout of a weak team can count as much as a close win over a good one if it beat
// expectations by more, which is why the expected margin is shown.
export function WhyRanked({ teamId, games, byId }: { teamId: number; games: Game[]; byId: Map<number, Rating> }) {
  const { sport, season, base, meta } = useCtx();
  const imp = useAsync(() => restAll<Impact>(`team_game_impact?sport_id=eq.${sport}&season_year=eq.${season}&team_id=eq.${teamId}&select=game_id,game_adj_em,contrib`), [sport, season, teamId]);
  if (imp.loading) return <Loading rows={3} />;
  const all = [...byId.values()]; const L = league(all); const me = byId.get(teamId);
  const k = meta.typicalUnits / meta.scale;
  let rows = (imp.data ?? []).map((x) => ({ ...x, contrib: Number(x.contrib), g: games.find((g) => g.id === x.game_id) })).filter((x) => x.g && x.g.home_score != null);
  // Seasons rated before we started saving each game's effect: rank games by how far the result beat the
  // expected score, using the end-of-season ratings. Same idea, shown as points beyond what was expected.
  const fallback = !rows.length && !!me;
  if (fallback) rows = games.filter((g) => g.completed && g.home_score != null).flatMap((g) => {
    const home = g.home_team_id === teamId; const opp = byId.get(home ? g.away_team_id : g.home_team_id);
    if (!opp) return [];
    const pr = predict(me!, opp, L, (g.neutral_site ? 0 : home ? 1 : -1) as 1 | 0 | -1, sport);
    const m = home ? g.home_score! - g.away_score! : g.away_score! - g.home_score!;
    return [{ game_id: g.id, game_adj_em: 0, contrib: (m - pr.margin) / k, g }];
  });
  if (!rows.length || !me) return <p className="muted sm">No games against Division I teams yet. Games against lower-division schools don't count toward the rating, so this fills in after the first one.</p>;
  const cut = fallback ? 0.5 / k : 0.05;
  const up = [...rows].sort((a, b) => b.contrib - a.contrib).slice(0, 3).filter((x) => x.contrib > cut);
  const down = [...rows].sort((a, b) => a.contrib - b.contrib).slice(0, 3).filter((x) => x.contrib < -cut);
  const by = (m: number) => (Math.abs(m) < 0.5 ? 'about even' : `${m > 0 ? 'win' : 'lose'} by ${Math.abs(m).toFixed(0)}`);
  const line = (x: typeof rows[number]) => {
    const g = x.g!; const home = g.home_team_id === teamId;
    const us = home ? g.home_score! : g.away_score!, them = home ? g.away_score! : g.home_score!;
    const oppId = home ? g.away_team_id : g.home_team_id; const opp = byId.get(oppId);
    const oppName = home ? g.away_name : g.home_name;
    const pr = opp ? predict(me, opp, L, (g.neutral_site ? 0 : home ? 1 : -1) as 1 | 0 | -1, sport) : null;
    return (
      <li key={x.game_id} className="why-row">
        <div>
          <Link to={`${base}/game/${g.id}`}><b className={us > them ? 'W' : 'L'}>{us > them ? 'W' : 'L'} {us}-{them}</b></Link> <span className="muted">{g.neutral_site ? 'vs' : home ? 'vs' : 'at'}</span> {oppName}{opp ? <span className="muted sm"> #{opp.rank}</span> : null}
          {pr && <div className="muted sm">Expected to {by(pr.margin)} · {us > them ? 'won' : 'lost'} by {Math.abs(us - them)}</div>}
        </div>
        <b className="num" style={{ color: x.contrib > 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(x.contrib * k, fallback ? 0 : 1)}</b>
      </li>
    );
  };
  return (
    <>
      <p className="muted sm" style={{ margin: '0 0 8px' }}>The games that moved {me.short_name}'s rating most. What matters is beating expectations: winning big when expected to win big doesn't move much; winning bigger than expected, or holding a team to almost nothing, does. {fallback ? `Numbers are ${meta.pointWord} better or worse than expected, judged against how good each team turned out to be.` : `Numbers are ${meta.pointWord} per game added to or taken off the rating.`}</p>
      {up.length > 0 && <><div className="sm" style={{ fontWeight: 800 }}>Better than expected</div><ul className="sched" style={{ marginBottom: 12 }}>{up.map(line)}</ul></>}
      {down.length > 0 && <><div className="sm" style={{ fontWeight: 800 }}>Worse than expected</div><ul className="sched">{down.map(line)}</ul></>}
    </>
  );
}
