import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { restAll } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Loading, ErrorBox, TeamCell } from '../components/Shell';

// Leaderboards, team and individual, for every sport. A stat is a label plus how to compute it from a season row.
type Stat = { key: string; label: string; desc: string; calc: (r: any) => number | null; fmt?: (v: number) => string; asc?: boolean; min?: (r: any) => boolean };
const N = (v: any) => (v == null || v === '' ? 0 : Number(v));
const f1 = (v: number) => v.toFixed(1), f0 = (v: number) => String(Math.round(v)), pct = (v: number) => `${(100 * v).toFixed(1)}%`, f3 = (v: number) => v.toFixed(3).replace(/^0/, '');

const hoopsPlayers: Stat[] = [
  { key: 'ppg', label: 'Points', desc: 'per game', calc: (r) => N(r.pts) / N(r.gp), fmt: f1 },
  { key: 'rpg', label: 'Rebounds', desc: 'per game', calc: (r) => N(r.reb) / N(r.gp), fmt: f1 },
  { key: 'apg', label: 'Assists', desc: 'per game', calc: (r) => N(r.ast) / N(r.gp), fmt: f1 },
  { key: 'spg', label: 'Steals', desc: 'per game', calc: (r) => N(r.stl) / N(r.gp), fmt: f1 },
  { key: 'bpg', label: 'Blocks', desc: 'per game', calc: (r) => N(r.blk) / N(r.gp), fmt: f1 },
  { key: 'tpm', label: '3-pointers', desc: 'made per game', calc: (r) => N(r.tpm) / N(r.gp), fmt: f1 },
  { key: 'fg', label: 'FG%', desc: 'min. 5 attempts per game', calc: (r) => N(r.fgm) / N(r.fga), fmt: pct, min: (r) => N(r.fga) / N(r.gp) >= 5 },
  { key: 'tp', label: '3P%', desc: 'min. 3 attempts per game', calc: (r) => N(r.tpm) / N(r.tpa), fmt: pct, min: (r) => N(r.tpa) / N(r.gp) >= 3 },
  { key: 'ft', label: 'FT%', desc: 'min. 2 attempts per game', calc: (r) => N(r.ftm) / N(r.fta), fmt: pct, min: (r) => N(r.fta) / N(r.gp) >= 2 },
  { key: 'mpg', label: 'Minutes', desc: 'per game', calc: (r) => N(r.min) / N(r.gp), fmt: f1 },
];
const hoopsTeams: Stat[] = [
  { key: 'ppg', label: 'Points', desc: 'per game', calc: (r) => N(r.pf) / N(r.gp), fmt: f1 },
  { key: 'papg', label: 'Points allowed', desc: 'per game, fewest first', calc: (r) => N(r.pa) / N(r.gp), fmt: f1, asc: true },
  { key: 'margin', label: 'Scoring margin', desc: 'per game', calc: (r) => (N(r.pf) - N(r.pa)) / N(r.gp), fmt: (v) => (v > 0 ? '+' : '') + f1(v) },
  { key: 'fg', label: 'FG%', desc: '', calc: (r) => N(r.totals.fieldGoalsMade) / N(r.totals.fieldGoalsAttempted), fmt: pct },
  { key: 'tp', label: '3P%', desc: '', calc: (r) => N(r.totals.threePointFieldGoalsMade) / N(r.totals.threePointFieldGoalsAttempted), fmt: pct },
  { key: 'tpa', label: '3-pointers attempted', desc: 'per game', calc: (r) => N(r.totals.threePointFieldGoalsAttempted) / N(r.games), fmt: f1 },
  { key: 'oppfg', label: 'Opponent FG%', desc: 'lowest first', calc: (r) => N(r.opp_totals.fieldGoalsMade) / N(r.opp_totals.fieldGoalsAttempted), fmt: pct, asc: true },
  { key: 'reb', label: 'Rebounds', desc: 'per game', calc: (r) => N(r.totals.totalRebounds) / N(r.games), fmt: f1 },
  { key: 'ast', label: 'Assists', desc: 'per game', calc: (r) => N(r.totals.assists) / N(r.games), fmt: f1 },
  { key: 'tov', label: 'Turnovers', desc: 'per game, fewest first', calc: (r) => N(r.totals.totalTurnovers || r.totals.turnovers) / N(r.games), fmt: f1, asc: true },
  { key: 'stl', label: 'Steals', desc: 'per game', calc: (r) => N(r.totals.steals) / N(r.games), fmt: f1 },
  { key: 'blk', label: 'Blocks', desc: 'per game', calc: (r) => N(r.totals.blocks) / N(r.games), fmt: f1 },
];
const diamondPlayers: Stat[] = [
  { key: 'avg', label: 'Batting avg', desc: 'min. 2 at-bats per game', calc: (r) => N(r.h) / N(r.ab), fmt: f3, min: (r) => N(r.ab) >= 2 * N(r.g_bat) && N(r.g_bat) >= 5 },
  { key: 'obp', label: 'On-base %', desc: 'min. 2 at-bats per game', calc: (r) => (N(r.h) + N(r.bb)) / (N(r.ab) + N(r.bb)), fmt: f3, min: (r) => N(r.ab) >= 2 * N(r.g_bat) && N(r.g_bat) >= 5 },
  { key: 'h', label: 'Hits', desc: 'total', calc: (r) => N(r.h), fmt: f0 },
  { key: 'rbi', label: 'RBI', desc: 'total', calc: (r) => N(r.rbi), fmt: f0 },
  { key: 'r', label: 'Runs', desc: 'total', calc: (r) => N(r.r), fmt: f0 },
  { key: 'bb', label: 'Walks', desc: 'total', calc: (r) => N(r.bb), fmt: f0 },
  { key: 'era', label: 'ERA', desc: 'min. 20 innings, lowest first', calc: (r) => (N(r.er) * 9) / N(r.ip), fmt: (v) => v.toFixed(2), asc: true, min: (r) => N(r.ip) >= 20 },
  { key: 'k', label: 'Strikeouts', desc: 'pitching, total', calc: (r) => N(r.k), fmt: f0, min: (r) => N(r.ip) > 0 },
  { key: 'k9', label: 'K per 9', desc: 'min. 20 innings', calc: (r) => (N(r.k) * 9) / N(r.ip), fmt: f1, min: (r) => N(r.ip) >= 20 },
  { key: 'ip', label: 'Innings', desc: 'pitched', calc: (r) => N(r.ip), fmt: f1 },
];
const diamondTeams: Stat[] = [
  { key: 'rpg', label: 'Runs', desc: 'per game', calc: (r) => N(r.pf) / N(r.gp), fmt: f1 },
  { key: 'rapg', label: 'Runs allowed', desc: 'per game, fewest first', calc: (r) => N(r.pa) / N(r.gp), fmt: f1, asc: true },
  { key: 'avg', label: 'Batting avg', desc: '', calc: (r) => N(r.totals.hits) / N(r.totals.atBats), fmt: f3 },
  { key: 'obp', label: 'On-base %', desc: '', calc: (r) => (N(r.totals.hits) + N(r.totals.walks)) / (N(r.totals.atBats) + N(r.totals.walks)), fmt: f3 },
  { key: 'era', label: 'ERA', desc: 'lowest first', calc: (r) => (N(r.totals.earnedRunsAllowed) * (r.sport_id === 'sb' ? 7 : 9)) / N(r.totals.inningsPitched), fmt: (v) => v.toFixed(2), asc: true },
  { key: 'k9', label: 'K per 9', desc: 'pitching', calc: (r) => (N(r.totals.strikeoutsPitched) * 9) / N(r.totals.inningsPitched), fmt: f1 },
  { key: 'oppavg', label: 'Opponent avg', desc: 'lowest first', calc: (r) => N(r.opp_totals.hits) / N(r.opp_totals.atBats), fmt: f3, asc: true },
  { key: 'win', label: 'Win %', desc: '', calc: (r) => N(r.wins) / N(r.gp), fmt: f3 },
];
const cfbPlayers: Stat[] = [
  { key: 'pyds', label: 'Passing yards', desc: 'total', calc: (r) => (r.stat_group === 'passing' ? N(r.totals.passingYards) : null), fmt: f0 },
  { key: 'ptd', label: 'Passing TDs', desc: 'total', calc: (r) => (r.stat_group === 'passing' ? N(r.totals.passingTouchdowns) : null), fmt: f0 },
  { key: 'ryds', label: 'Rushing yards', desc: 'total', calc: (r) => (r.stat_group === 'rushing' ? N(r.totals.rushingYards) : null), fmt: f0 },
  { key: 'rtd', label: 'Rushing TDs', desc: 'total', calc: (r) => (r.stat_group === 'rushing' ? N(r.totals.rushingTouchdowns) : null), fmt: f0 },
  { key: 'ypc', label: 'Yards per carry', desc: 'min. 50 carries', calc: (r) => (r.stat_group === 'rushing' ? N(r.totals.rushingYards) / N(r.totals.rushingAttempts) : null), fmt: f1, min: (r) => N(r.totals.rushingAttempts) >= 50 },
  { key: 'rec', label: 'Receptions', desc: 'total', calc: (r) => (r.stat_group === 'receiving' ? N(r.totals.receptions) : null), fmt: f0 },
  { key: 'recyds', label: 'Receiving yards', desc: 'total', calc: (r) => (r.stat_group === 'receiving' ? N(r.totals.receivingYards) : null), fmt: f0 },
  { key: 'rectd', label: 'Receiving TDs', desc: 'total', calc: (r) => (r.stat_group === 'receiving' ? N(r.totals.receivingTouchdowns) : null), fmt: f0 },
  { key: 'tkl', label: 'Tackles', desc: 'total', calc: (r) => (r.stat_group === 'defensive' ? N(r.totals.totalTackles) : null), fmt: f0 },
  { key: 'sacks', label: 'Sacks', desc: 'total', calc: (r) => (r.stat_group === 'defensive' ? N(r.totals.sacks) : null), fmt: f1 },
  { key: 'tfl', label: 'Tackles for loss', desc: 'total', calc: (r) => (r.stat_group === 'defensive' ? N(r.totals.tacklesForLoss) : null), fmt: f0 },
  { key: 'int', label: 'Interceptions', desc: 'total', calc: (r) => (r.stat_group === 'interceptions' ? N(r.totals.interceptions) : null), fmt: f0 },
];
const cfbTeams: Stat[] = [
  { key: 'ppg', label: 'Points', desc: 'per game', calc: (r) => N(r.pf) / N(r.gp), fmt: f1 },
  { key: 'papg', label: 'Points allowed', desc: 'per game, fewest first', calc: (r) => N(r.pa) / N(r.gp), fmt: f1, asc: true },
  { key: 'yds', label: 'Total yards', desc: 'per game', calc: (r) => N(r.totals.totalYards) / N(r.games), fmt: f1 },
  { key: 'ryds', label: 'Rushing yards', desc: 'per game', calc: (r) => N(r.totals.rushingYards) / N(r.games), fmt: f1 },
  { key: 'pyds', label: 'Passing yards', desc: 'per game', calc: (r) => N(r.totals.netPassingYards) / N(r.games), fmt: f1 },
  { key: 'oppyds', label: 'Yards allowed', desc: 'per game, fewest first', calc: (r) => N(r.opp_totals.totalYards) / N(r.games), fmt: f1, asc: true },
  { key: 'ppd', label: 'Points per drive', desc: '', calc: (r) => N(r.pf) / N(r.totals.drives), fmt: (v) => v.toFixed(2) },
  { key: 'to', label: 'Turnovers', desc: 'per game, fewest first', calc: (r) => N(r.totals.turnovers) / N(r.games), fmt: f1, asc: true },
];

export function LeadersPage() {
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const nav = useNavigate();
  const [who, setWho] = useState<'players' | 'teams'>('players');
  const src = meta.hoops ? 'mv_player_season' : sport === 'cfb' ? 'mv_cfb_season' : 'mv_diamond_season';
  // Early in a season (a game or two each) leaderboards are noise, so show last season's until teams have played
  // a few games. One tap switches to this season anyway.
  const prevSeason = meta.seasons.find((x) => x.year === season - 1)?.year ?? null;
  const [forceCurrent, setForceCurrent] = useState(false);
  const cur = useAsync(() => restAll<any>(`mv_team_season?select=gp&sport_id=eq.${sport}&season_year=eq.${season}`), [sport, season]);
  const curMaxGp = Math.max(0, ...(cur.data ?? []).map((r: any) => N(r.gp)));
  const showPrev = !forceCurrent && prevSeason != null && !cur.loading && curMaxGp < 5;
  const shown = showPrev ? prevSeason! : season;
  const players = useAsync(() => cur.loading ? new Promise<any[]>(() => {}) : restAll<any>(`${src}?sport_id=eq.${sport}&season_year=eq.${shown}`), [src, sport, shown, cur.loading]);
  const teams = useAsync(() => cur.loading ? new Promise<any[]>(() => {}) : restAll<any>(`mv_team_season?sport_id=eq.${sport}&season_year=eq.${shown}`), [sport, shown, cur.loading]);
  const pStats = meta.hoops ? hoopsPlayers : sport === 'cfb' ? cfbPlayers : diamondPlayers;
  const tStats = meta.hoops ? hoopsTeams : sport === 'cfb' ? cfbTeams : diamondTeams;
  const stats = who === 'players' ? pStats : tStats;
  const [key, setKey] = useState(stats[0].key);
  const stat = stats.find((s) => s.key === key) ?? stats[0];
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);

  const rows = useMemo(() => {
    const data = who === 'players' ? players.data : teams.data;
    if (!data) return [];
    const maxGp = Math.max(1, ...(who === 'players' ? data.map((r: any) => N(r.gp ?? r.g_bat ?? r.games)) : data.map((r: any) => N(r.gp))));
    const out: { r: any; v: number }[] = [];
    for (const r of data) {
      if (who === 'players') {
        const gp = N(r.gp ?? r.games ?? Math.max(N(r.g_bat), N(r.g_pit)));
        if (gp < Math.max(maxGp < 5 ? 1 : 3, maxGp * 0.4) && !(sport !== 'cfb' && !meta.hoops)) continue;   // regulars only
        if (byId.size && !showPrev && !byId.has(r.team_id)) continue;                      // Division I teams only
      }
      if (stat.min && !stat.min(r)) continue;
      const v = stat.calc(r);
      if (v == null || !Number.isFinite(v)) continue;
      out.push({ r, v });
    }
    out.sort((a, b) => (stat.asc ? a.v - b.v : b.v - a.v));
    return out.slice(0, 100);
  }, [who, players.data, teams.data, stat, byId, sport, meta.hoops, showPrev]);

  // Columns: the chosen stat first, then neighbours from the same list. Tap any column header to rank by it.
  // Football players come in separate groups (passing, rushing...), so only the chosen stat is shown there.
  const cols = sport === 'cfb' && who === 'players' ? [stat] : [stat, ...stats.filter((x) => x.key !== stat.key)].slice(0, 6);
  if (R.loading || cur.loading || players.loading || teams.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;

  return (
    <>
      <h1>Leaders</h1>
      <p className="sub">{meta.long}, {meta.seasons.find((s) => s.year === shown)?.label}. Tap any column to rank by it.</p>
      {showPrev && <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span>The season just started, so these are <b>last season's</b> leaders. This season's take over after a few games.</span><button className="btn ghost" onClick={() => setForceCurrent(true)}>Show this season</button></div>}
      <div className="chips">
        <button className={`chip ${who === 'players' ? 'on' : ''}`} onClick={() => { setWho('players'); setKey(pStats[0].key); }}>Players</button>
        <button className={`chip ${who === 'teams' ? 'on' : ''}`} onClick={() => { setWho('teams'); setKey(tStats[0].key); }}>Teams</button>
      </div>
      <div className="chips scroll">
        {stats.map((s) => <button key={s.key} className={`chip ${s.key === stat.key ? 'on' : ''}`} onClick={() => setKey(s.key)}>{s.label}</button>)}
      </div>
      <div className="panel">
        <h3>{stat.label} <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}>{stat.desc}</span></h3>
        {!rows.length && <p className="muted">Nothing here yet. Check back once games have been played.</p>}
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>#</th><th className="l">{who === 'players' ? 'Player' : 'Team'}</th><th className="l hide-sm">{who === 'players' ? 'Team' : 'Conf'}</th><th className="hide-sm">{who === 'players' ? 'GP' : 'Record'}</th>
              {cols.map((c, ci) => <th key={c.key} className={`${c.key === stat.key ? 'sorted' : ''} ${ci >= 2 ? 'hide-sm' : ''}`} onClick={() => setKey(c.key)} title={`Sort by ${c.label}`}>{c.label}{c.key === stat.key ? (stat.asc ? ' ↑' : ' ↓') : ''}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(({ r, v }, i) => {
                const team = byId.get(r.team_id);
                return (
                  <tr key={who === 'players' ? `${r.player_id}-${r.stat_group ?? ''}` : r.team_id} className="row" onClick={() => nav(`${base}/team/${r.team_id}`)}>
                    <td className="rk">{i + 1}</td>
                    <td className="l">{who === 'players' ? <span className="team" style={{ gap: 8 }}>{team?.logo_url && <img src={team.logo_url} alt="" loading="lazy" />}<Link to={`${base}/player/${r.player_id}`} onClick={(e) => e.stopPropagation()}><b>{r.display_name}</b></Link></span> : <TeamCell name={team?.short_name ?? '–'} logo={team?.logo_url} color={team?.color} />}</td>
                    <td className="l hide-sm muted">{who === 'players' ? (team ? <Link to={`${base}/team/${r.team_id}`}>{team.short_name}</Link> : '–') : team?.conference_short}</td>
                    <td className="num hide-sm">{who === 'players' ? N(r.gp ?? r.games ?? (stat.key.match(/era|k9|ip|^k$/) ? r.g_pit : r.g_bat)) : `${N(r.wins)}-${N(r.gp) - N(r.wins)}`}</td>
                    {cols.map((c, ci) => { const cv = c.key === stat.key ? v : c.calc(r); return <td key={c.key} className={`num ${ci >= 2 ? 'hide-sm' : ''}`} style={c.key === stat.key ? { fontSize: 18, fontWeight: 700 } : undefined}>{cv == null || !Number.isFinite(cv) ? '–' : (c.fmt ?? f1)(cv)}</td>; })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
