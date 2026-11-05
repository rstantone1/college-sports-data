import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { rest, restAll } from '../api';
import { useAsync, useCtx, useRatings, teamColor, onColor, fmtDate } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { ShotChart } from '../components/Charts';
import { Bars, type BarRow } from '../components/Bars';
import { percentile } from '../hooks';

interface AdvRow { player_id: number; team_id: number; gp: number; min: number; ppg: number; rpg: number; apg: number; mpg: number; pts40: number; reb40: number; ast40: number; stl40: number; blk40: number; tov40: number; efg: number; ts: number; tp_pct: number | null; ft_pct: number | null; tpa_rate: number; ftr: number; ast_tov: number | null; usage: number; min_share: number }
interface RosterRow { team_id: number; season_year: number; jersey: string | null; position: string | null; height_in: number | null; weight_lb: number | null; class_year: string | null; hometown: string | null; home_state: string | null; home_country: string | null }
interface GameRow { game_id: number; team_id: number; season_year: number; start_time: string; completed: boolean; starter: boolean | null; did_not_play: boolean; stat_group: string | null; stats: Record<string, number>; opp_team_id: number; team_score: number | null; opp_score: number | null; site: 'H' | 'A' | 'N' }

const ht = (n: number | null) => (n ? `${Math.floor(n / 12)}'${n % 12}"` : null);
const N = (v: any) => Number(v) || 0;

export function PlayerPage() {
  const { playerId } = useParams();
  const id = Number(playerId);
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const player = useAsync(() => rest<{ id: number; display_name: string; sport_id: string }[]>(`players?id=eq.${id}`).then((r) => r[0]), [id]);
  const roster = useAsync(() => rest<RosterRow[]>(`rosters?player_id=eq.${id}&order=season_year.desc`), [id]);
  const games = useAsync(() => restAll<GameRow>(`v_player_games?player_id=eq.${id}&order=start_time.desc`), [id]);
  // Advanced stats for every regular in the sport this season (at least 40 minutes), for the percentile bars.
  const adv = useAsync(() => meta.hoops ? restAll<AdvRow>(`v_player_adv?sport_id=eq.${sport}&season_year=eq.${season}&min=gte.40&select=player_id,team_id,gp,min,ppg,rpg,apg,mpg,pts40,reb40,ast40,stl40,blk40,tov40,efg,ts,tp_pct,ft_pct,tpa_rate,ftr,ast_tov,usage,min_share`) : Promise.resolve([] as AdvRow[]), [sport, season, meta.hoops]);
  const shots = useAsync(() => meta.hoops ? rest<{ game_id: number; x: number; y: number; made: boolean; three: boolean }[]>(`rpc/player_shots?p_player_id=${id}&p_season=${season}`) : Promise.resolve([]), [id, season, meta.hoops]);
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);

  if (player.loading || roster.loading || R.loading) return <Loading />;
  if (player.error || !player.data) return <ErrorBox msg={player.error ?? 'Player not found.'} />;

  const p = player.data;
  // Player ids are global; a link from the wrong sport's pages lands here. Send it to the player's own sport.
  if (p.sport_id && p.sport_id !== sport) return <Navigate to={`/${p.sport_id}/${season}/player/${id}`} replace />;
  const rs = roster.data ?? [];
  const cur = rs.find((r) => r.season_year === season) ?? rs[0];
  const bio = rs.reduce((acc, r) => ({ height_in: acc.height_in ?? r.height_in, weight_lb: acc.weight_lb ?? r.weight_lb, class_year: acc.class_year ?? r.class_year, hometown: acc.hometown ?? r.hometown, home_state: acc.home_state ?? r.home_state, home_country: acc.home_country ?? r.home_country, position: acc.position ?? r.position, jersey: acc.jersey ?? r.jersey }), { height_in: null, weight_lb: null, class_year: null, hometown: null, home_state: null, home_country: null, position: null, jersey: null } as any);
  const team = cur ? byId.get(cur.team_id) : undefined;
  const color = teamColor(team?.color, '#0B1220'), ink = onColor(color);
  const initials = p.display_name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('');
  const seasonsPlayed = [...new Set(rs.map((r) => r.season_year))].sort();
  const moved = rs.length > 1 && new Set(rs.map((r) => r.team_id)).size > 1;

  const thisSeason = (games.data ?? []).filter((g) => g.season_year === season && !g.did_not_play);
  const played = thisSeason.filter((g) => g.completed);
  const sum = (k: string, rows = played, grp?: string) => rows.filter((g) => !grp || g.stat_group === grp).reduce((a, g) => a + N(g.stats[k]), 0);
  const gp = meta.hoops ? played.filter((g) => (g.stat_group ?? 'box') === 'box').length : sport === 'cfb' ? new Set(played.map((g) => g.game_id)).size : new Set(played.map((g) => g.game_id)).size;

  const cards = meta.hoops ? [
    ['Points', (sum('points') / gp).toFixed(1), 'per game'], ['Rebounds', (sum('rebounds') / gp).toFixed(1), 'per game'], ['Assists', (sum('assists') / gp).toFixed(1), 'per game'],
    ['FG%', sum('fieldGoalsAttempted') ? `${(100 * sum('fieldGoalsMade') / sum('fieldGoalsAttempted')).toFixed(0)}%` : '–', `${sum('fieldGoalsMade')}-${sum('fieldGoalsAttempted')}`],
    ['3P%', sum('threePointFieldGoalsAttempted') ? `${(100 * sum('threePointFieldGoalsMade') / sum('threePointFieldGoalsAttempted')).toFixed(0)}%` : '–', `${sum('threePointFieldGoalsMade')}-${sum('threePointFieldGoalsAttempted')}`],
    ['Minutes', (sum('minutes') / gp).toFixed(1), 'per game'],
  ] : sport === 'cfb' ? (() => {
    const out: [string, string, string][] = [];
    if (sum('passingYards', played, 'passing')) out.push(['Passing', String(sum('passingYards', played, 'passing')), `yds · ${sum('passingTouchdowns', played, 'passing')} TD`]);
    if (sum('rushingYards', played, 'rushing')) out.push(['Rushing', String(sum('rushingYards', played, 'rushing')), `yds · ${sum('rushingTouchdowns', played, 'rushing')} TD`]);
    if (sum('receivingYards', played, 'receiving')) out.push(['Receiving', String(sum('receivingYards', played, 'receiving')), `yds · ${sum('receptions', played, 'receiving')} rec`]);
    if (sum('totalTackles', played, 'defensive')) out.push(['Tackles', String(sum('totalTackles', played, 'defensive')), `${sum('sacks', played, 'defensive')} sacks`]);
    return out;
  })() : (() => {
    const ab = sum('atBats', played, 'batting'), h = sum('hits', played, 'batting'), bb = sum('walks', played, 'batting'), ip = sum('inningsPitched', played, 'pitching'), er = sum('earnedRunsAllowed', played, 'pitching');
    const out: [string, string, string][] = [];
    if (ab) out.push(['Average', (h / ab).toFixed(3).replace(/^0/, ''), `${h}-${ab}`], ['On-base', ((h + bb) / (ab + bb)).toFixed(3).replace(/^0/, ''), `${bb} walks`], ['RBI', String(sum('rbi', played, 'batting')), `${sum('runs', played, 'batting')} runs`]);
    if (ip) out.push(['ERA', ((er * (sport === 'sb' ? 7 : 9)) / ip).toFixed(2), `${ip.toFixed(1)} IP`], ['Strikeouts', String(sum('strikeouts', played, 'pitching')), 'pitching']);
    return out;
  })();

  const logCols: [string, (g: GameRow) => string][] = meta.hoops
    ? [['MIN', (g) => String(g.stats.minutes ?? '–')], ['PTS', (g) => String(g.stats.points ?? 0)], ['REB', (g) => String(g.stats.rebounds ?? 0)], ['AST', (g) => String(g.stats.assists ?? 0)], ['FG', (g) => `${g.stats.fieldGoalsMade ?? 0}-${g.stats.fieldGoalsAttempted ?? 0}`], ['3P', (g) => `${g.stats.threePointFieldGoalsMade ?? 0}-${g.stats.threePointFieldGoalsAttempted ?? 0}`]]
    : sport === 'cfb'
    ? [['Group', (g) => g.stat_group ?? ''], ['Line', (g) => Object.entries(g.stats).slice(0, 4).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').split(' ')[0]} ${v}`).join(' · ')]]
    : [['', (g) => g.stat_group === 'pitching' ? 'P' : 'B'], ['AB/IP', (g) => g.stat_group === 'pitching' ? String(g.stats.inningsPitched ?? 0) : String(g.stats.atBats ?? 0)], ['H', (g) => String(g.stat_group === 'pitching' ? g.stats.hitsAllowed ?? 0 : g.stats.hits ?? 0)], ['R/ER', (g) => String(g.stat_group === 'pitching' ? g.stats.earnedRunsAllowed ?? 0 : g.stats.runs ?? 0)], ['RBI/K', (g) => String(g.stat_group === 'pitching' ? g.stats.strikeouts ?? 0 : g.stats.rbi ?? 0)]];

  return (
    <>
      <Back />
      <section className="hero" style={{ background: color, color: ink }}>
        <div className="in">
          <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(255,255,255,.92)', color, display: 'grid', placeItems: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 34, flex: '0 0 auto' }}>{initials}</div>
          <div>
            <h1 style={{ color: ink }}>{p.display_name}</h1>
            <div style={{ fontWeight: 600, opacity: .92 }}>
              {[bio.jersey ? `#${bio.jersey}` : null, bio.position, bio.class_year, ht(bio.height_in), bio.weight_lb ? `${bio.weight_lb} lb` : null].filter(Boolean).join(' · ')}
            </div>
            <div style={{ opacity: .85, fontSize: 15 }}>
              {team && <Link to={`${base}/team/${team.team_id}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{team.short_name}</Link>}
              {team?.conference_short ? ` · ${team.conference_short}` : ''}
              {bio.hometown ? ` · ${bio.hometown}${bio.home_state ? `, ${bio.home_state}` : bio.home_country ? `, ${bio.home_country}` : ''}` : ''}
            </div>
          </div>
          {team && <div className="rankbig">#{team.rank}<small>{team.short_name} nationally</small></div>}
        </div>
      </section>

      {gp > 0 ? (
        <div className="cards" style={{ marginBottom: 16 }}>
          <div className="card"><div className="k">Games</div><div className="v">{gp}</div><div className="r">{played.filter((g) => g.starter).length} starts</div></div>
          {cards.map(([k, v, r]) => <div className="card" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="r">{r}</div></div>)}
        </div>
      ) : <div className="panel" style={{ marginBottom: 16 }}><p className="muted" style={{ margin: 0 }}>No games yet this season.</p></div>}

      {meta.hoops && gp > 0 && (() => {
        const rows = (adv.data ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : Number(v)])) as unknown as AdvRow);
        // Compare against players with a real role: at least a quarter of their team's minutes.
        const peers = rows.filter((r) => r.min_share >= 0.25 && r.gp >= 3);
        const mine = rows.find((r) => r.player_id === id);
        if (!mine || peers.length < 20) return null;
        const col = (k: keyof AdvRow) => peers.map((r) => r[k] as number);
        const P = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
        const F = (v: number | null, d = 1) => (v == null ? '–' : v.toFixed(d));
        const row = (label: string, k: keyof AdvRow, fmt: (v: number | null) => string, higher = true, note?: string): BarRow => ({ label, value: fmt(mine[k] as number | null), pct: percentile(col(k), mine[k] as number, higher), note });
        const prod: BarRow[] = [
          row('Scoring', 'pts40', F, true, 'points per 40 minutes'), row('Rebounding', 'reb40', F, true, 'rebounds per 40'), row('Passing', 'ast40', F, true, 'assists per 40'),
          row('Steals', 'stl40', (v) => F(v, 1)), row('Blocks', 'blk40', (v) => F(v, 1)), row('Ball security', 'tov40', (v) => F(v, 1), false, 'turnovers per 40; lower is better'),
        ];
        const eff: BarRow[] = [
          row('Usage', 'usage', P, true, 'share of the team\'s possessions this player ends while on the floor (role, not good or bad)'),
          row('Shooting efficiency', 'ts', P, true, 'true shooting %: points per shot, counting threes and free throws'),
          row('3-point %', 'tp_pct', P), row('Free throw %', 'ft_pct', P), row('Assist-to-turnover', 'ast_tov', (v) => F(v, 2)),
          row('Minutes', 'mpg', F, true, 'per game'),
        ];
        return (
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 2 }}>What kind of player</h3>
            <p className="muted sm" style={{ margin: '0 0 10px' }}>Each bar is where {p.display_name.split(' ').slice(-1)[0]} ranks among the {peers.length.toLocaleString()} regulars in {meta.long.toLowerCase()} this season.</p>
            <div className="grid g2e"><Bars title="Production, per 40 minutes" rows={prod} /><Bars title="Role and efficiency" rows={eff} /></div>
          </div>
        );
      })()}

      <div className="grid g2">
        <div className="panel">
          <h3>Game log</h3>
          {games.loading ? <Loading rows={5} /> : (
            <div className="tblwrap"><table className="box">
              <thead><tr><th>Date</th><th style={{ textAlign: 'left' }}>Opponent</th><th>Result</th>{logCols.map(([l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                {thisSeason.map((g, i) => {
                  const opp = byId.get(g.opp_team_id);
                  const w = g.completed && g.team_score != null && g.opp_score != null ? g.team_score > g.opp_score : null;
                  return (
                    <tr key={`${g.game_id}-${g.stat_group}-${i}`}>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}><Link to={`${base}/game/${g.game_id}`}>{fmtDate(g.start_time)}</Link></td>
                      <td style={{ textAlign: 'left' }}><span className="muted sm">{g.site === 'A' ? '@ ' : g.site === 'N' ? 'vs ' : ''}</span>{opp ? <Link to={`${base}/team/${opp.team_id}`}>{opp.short_name}</Link> : '–'}</td>
                      <td className={w == null ? '' : w ? 'W' : 'L'} style={{ fontWeight: 700 }}>{w == null ? '–' : `${w ? 'W' : 'L'} ${g.team_score}-${g.opp_score}`}</td>
                      {logCols.map(([l, f]) => <td key={l}>{f(g)}</td>)}
                    </tr>
                  );
                })}
                {!thisSeason.length && <tr><td colSpan={9} className="muted">No games this season yet.</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          {meta.hoops && (shots.data?.length ?? 0) > 0 && (
            <div className="panel"><h3>Shot chart, this season</h3><p className="muted sm">Games where shot locations were logged.</p><ShotChart shots={shots.data!} color={color === '#FFFFFF' ? '#0B1220' : color} title={p.display_name} /></div>
          )}
          <div className="panel">
            <h3>Career path</h3>
            {seasonsPlayed.length === 0 && <p className="muted">No roster history yet.</p>}
            {seasonsPlayed.map((y) => {
              const r = rs.find((x) => x.season_year === y)!; const t = byId.get(r.team_id);
              return <p key={y} style={{ margin: '0 0 6px' }}><b>{meta.seasons.find((s) => s.year === y)?.label ?? y}</b> · {t ? <Link to={`/${sport}/${y}/team/${r.team_id}`}>{t.short_name}</Link> : `team ${r.team_id}`}{r.class_year ? <span className="muted sm"> · {r.class_year}</span> : null}</p>;
            })}
            {moved && <p className="sm" style={{ marginTop: 8 }}><span className="pill win">Transfer</span> <Link to={`${base}/transfers`} style={{ color: 'var(--cool)', fontWeight: 600 }}>See all moves</Link></p>}
          </div>
        </div>
      </div>
    </>
  );
}
