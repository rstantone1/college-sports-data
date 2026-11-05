import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rest, restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings, teamColor, onColor, fmtDate } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { LineChart } from '../components/Charts';
import { f1, sign, pct, predict, league, perGame } from '../model';

interface CfbLine { player_id: number; display_name: string; stat_group: string; games: number; totals: Record<string, number> }
interface DiamondLine { player_id: number; display_name: string; g_bat: number; ab: number; r: number; h: number; rbi: number; bb: number; so: number; g_pit: number; ip: number; ha: number; er: number; bba: number; k: number; }
interface PlayerLine { player_id: number; display_name: string; gp: number; gs: number; min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number; }

export function TeamPage() {
  const { teamId } = useParams();
  const id = Number(teamId);
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const games = useAsync(() => restAll<Game>(`v_games?season_year=eq.${season}&sport_id=eq.${sport}&or=(home_team_id.eq.${id},away_team_id.eq.${id})&order=start_time.asc`), [id, sport, season]);
  const players = useAsync(() => meta.hoops ? rest<PlayerLine[]>(`mv_player_season?team_id=eq.${id}&season_year=eq.${season}&order=pts.desc`) : Promise.resolve([] as PlayerLine[]), [id, season, meta.hoops]);
  const cfb = useAsync(() => sport === 'cfb' ? rest<CfbLine[]>(`mv_cfb_season?team_id=eq.${id}&season_year=eq.${season}`) : Promise.resolve([] as CfbLine[]), [id, season, sport]);
  const moves = useAsync(() => meta.hoops ? rest<any[]>(`v_transfers?sport_id=eq.${sport}&season_year=eq.${season}&or=(to_team_id.eq.${id},from_team_id.eq.${id})&order=pts.desc.nullslast`) : Promise.resolve([] as any[]), [id, season, sport, meta.hoops]);
  const diamond = useAsync(() => !meta.hoops ? rest<DiamondLine[]>(`mv_diamond_season?team_id=eq.${id}&season_year=eq.${season}&order=h.desc.nullslast`) : Promise.resolve([] as DiamondLine[]), [id, season, meta.hoops]);
  const hist = useAsync(() => restAll<{ as_of: string; adj_em: number; rank: number }>(`ratings?select=as_of,adj_em,rank&team_id=eq.${id}&season_year=eq.${season}&order=as_of.asc`), [id, season]);
  const [tab, setTab] = useState<'sched' | 'roster'>('sched');

  const me = R.data?.find((r) => r.team_id === id);
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  const L = useMemo(() => league(R.data ?? []), [R.data]);

  if (R.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;
  if (!me) return <><Back /><div className="panel empty">This team has no rating this season yet.</div></>;

  const color = teamColor(me.color, '#0B1220');
  const dp = meta.hoops ? 1 : 2;
  const ink = onColor(color);
  const done = (games.data ?? []).filter((g) => g.completed && g.home_score != null);
  const wins = done.filter((g) => (g.home_team_id === id ? g.home_score! > g.away_score! : g.away_score! > g.home_score!)).length;
  const upcoming = (games.data ?? []).filter((g) => !g.completed);
  let projW = wins;
  for (const g of upcoming) {
    const oppId = g.home_team_id === id ? g.away_team_id : g.home_team_id;
    const opp = byId.get(oppId);
    if (!opp) { projW += 0.85; continue; }
    const site = g.neutral_site ? 0 : g.home_team_id === id ? 1 : -1;
    projW += predict(me, opp, L, site as 1 | 0 | -1, sport).aWin;
  }
  const totalG = done.length + upcoming.length;

  return (
    <>
      <Back />
      <section className="hero" style={{ background: color, color: ink }}>
        <div className="in">
          {me.logo_url && <img src={me.logo_url} alt="" />}
          <div>
            <h1 style={{ color: ink }}>{me.short_name}</h1>
            <div style={{ fontWeight: 600, opacity: .9 }}>{me.mascot} · {me.conference_name ?? 'Independent'} · {wins}-{done.length - wins}</div>
            {me.conference_id && <Link to={`${base}/conf/${me.conference_id}`} style={{ fontWeight: 700, textDecoration: 'underline', fontSize: 14 }}>See the {me.conference_short}</Link>}
          </div>
          <div className="rankbig">#{me.rank}<small>of {R.data!.length} nationally</small></div>
        </div>
      </section>

      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><div className="k">Rating</div><div className="v" style={{ color: me.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(perGame(me, sport).rating, dp)}</div><div className="r">{meta.pointWord} per game vs. an average team</div></div>
        <div className="card"><div className="k">Offense</div><div className="v">{perGame(me, sport).off.toFixed(dp)}</div><div className="r">{meta.pointWord} per game · #{me.off_rank}</div></div>
        <div className="card"><div className="k">Defense</div><div className="v">{perGame(me, sport).def.toFixed(dp)}</div><div className="r">allowed per game · #{me.def_rank}</div></div>
        {meta.hoops && <div className="card"><div className="k">Pace</div><div className="v">{f1(me.tempo)}</div><div className="r">possessions / game</div></div>}
        {upcoming.length > 0 && <div className="card"><div className="k">Projected record</div><div className="v">{Math.round(projW)}-{totalG - Math.round(projW)}</div><div className="r">{wins}-{done.length - wins} so far</div></div>}
      </div>

      <div className="grid g2">
        <div className="panel">
          <div className="chips">
            <button className={`chip ${tab === 'sched' ? 'on' : ''}`} onClick={() => setTab('sched')}>Schedule</button>
            <button className={`chip ${tab === 'roster' ? 'on' : ''}`} onClick={() => setTab('roster')}>Players</button>
          </div>
          {tab === 'sched' ? (
            games.loading ? <Loading rows={6} /> : (
              <ul className="sched">
                {(games.data ?? []).map((g) => {
                  const home = g.home_team_id === id;
                  const oppId = home ? g.away_team_id : g.home_team_id;
                  const opp = byId.get(oppId);
                  const oppName = home ? g.away_name : g.home_name;
                  const oppLogo = home ? g.away_logo : g.home_logo;
                  const site = g.neutral_site ? 0 : home ? 1 : -1;
                  const pred = opp ? predict(me, opp, L, site as 1 | 0 | -1, sport) : null;
                  let right: JSX.Element;
                  if (g.completed && g.home_score != null) {
                    const us = home ? g.home_score : g.away_score!, them = home ? g.away_score! : g.home_score;
                    const w = us > them;
                    right = <Link to={`${base}/game/${g.id}`} className={`res ${w ? 'W' : 'L'}`}>{w ? 'W' : 'L'} {us}-{them}</Link>;
                  } else {
                    right = pred ? <span className={`pill ${pred.aWin >= .5 ? 'win' : 'loss'}`}>{pct(pred.aWin)} · {Math.round(pred.aPts)}-{Math.round(pred.bPts)}</span> : <span className="pill">—</span>;
                  }
                  return (
                    <li key={g.id}>
                      <span className="muted sm">{fmtDate(g.start_time)}</span>
                      {oppLogo ? <img src={oppLogo} alt="" width={22} height={22} style={{ objectFit: 'contain' }} /> : <span />}
                      <span>
                        <span className="muted sm">{g.neutral_site ? 'vs ' : home ? '' : '@ '}</span>
                        {opp ? <Link to={`${base}/team/${oppId}`} style={{ fontWeight: 600 }}>{oppName}</Link> : <span style={{ fontWeight: 600 }}>{oppName}</span>}
                        {opp && <span className="muted sm"> #{opp.rank}</span>}
                      </span>
                      {right}
                    </li>
                  );
                })}
                {!games.data?.length && <li className="muted">No games yet.</li>}
              </ul>
            )
          ) : (
            meta.hoops ? <Roster rows={players.data ?? []} loading={players.loading} /> : sport === 'cfb' ? <CfbRoster rows={cfb.data ?? []} loading={cfb.loading} /> : <DiamondRoster rows={diamond.data ?? []} loading={diamond.loading} />
          )}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="panel">
            <h3>Rating over the season</h3>
            <p className="muted sm">{meta.pointWord[0].toUpperCase() + meta.pointWord.slice(1)} per game better than average, day by day.</p>
            <LineChart color={color === '#FFFFFF' ? '#0B1220' : color}
              points={(hist.data ?? []).map((h) => ({ x: fmtDate(h.as_of + 'T12:00:00'), y: Number(h.adj_em) * (me.tempo / meta.scale) }))} yLabel="Rating over time" />
          </div>
          {meta.hoops && (moves.data?.length ?? 0) > 0 && (
            <div className="panel">
              <h3>Portal moves</h3>
              {moves.data!.filter((m) => m.to_team_id === id).length > 0 && <p className="sm muted" style={{ margin: '0 0 4px' }}>Arrived</p>}
              {moves.data!.filter((m) => m.to_team_id === id).map((m) => <p key={m.player_id} style={{ margin: '0 0 6px' }}><Link to={`${base}/player/${m.player_id}`}><b>{m.display_name}</b></Link> <span className="muted sm">from {m.from_team}{m.gp ? ` · ${(Number(m.pts) / m.gp).toFixed(1)} ppg` : ''}</span></p>)}
              {moves.data!.filter((m) => m.from_team_id === id).length > 0 && <p className="sm muted" style={{ margin: '8px 0 4px' }}>Left</p>}
              {moves.data!.filter((m) => m.from_team_id === id).map((m) => <p key={m.player_id} style={{ margin: '0 0 6px' }}><Link to={`${base}/player/${m.player_id}`}><b>{m.display_name}</b></Link> <span className="muted sm">to {m.to_team}{m.gp ? ` · ${(Number(m.pts) / m.gp).toFixed(1)} ppg` : ''}</span></p>)}
              <Link to={`${base}/transfers`} style={{ color: 'var(--cool)', fontWeight: 600, fontSize: 14 }}>All transfers</Link>
            </div>
          )}
          {meta.tourney && (
            <div className="panel">
              <h3>Tournament picture</h3>
              <p className="muted sm">Odds of making the field, seed line, and projected record.</p>
              <Link className="btn ghost" to={`${base}/tournament`}>Open tournament odds</Link>
            </div>
          )}
          <div className="panel">
            <h3>Try a matchup</h3>
            <p className="muted sm">See how {me.short_name} would do against anyone, anywhere.</p>
            <Link className="btn" to={`${base}/matchup?a=${id}`}>Open matchup</Link>
          </div>
        </div>
      </div>
    </>
  );
}

function Roster({ rows, loading }: { rows: PlayerLine[]; loading: boolean }) {
  const { base } = useCtx();
  const [per, setPer] = useState<'game' | 'total'>('game');
  if (loading) return <Loading rows={6} />;
  if (!rows.length) return <p className="muted">Player stats appear after the first game is processed.</p>;
  const d = (v: number, gp: number) => (per === 'game' ? (gp ? (Number(v) / gp).toFixed(1) : '–') : String(Math.round(Number(v))));
  const pctS = (m: number, a: number) => (Number(a) ? (100 * Number(m) / Number(a)).toFixed(0) + '%' : '–');
  return (
    <>
      <div className="chips">
        <button className={`chip ${per === 'game' ? 'on' : ''}`} onClick={() => setPer('game')}>Per game</button>
        <button className={`chip ${per === 'total' ? 'on' : ''}`} onClick={() => setPer('total')}>Totals</button>
      </div>
      <div className="tblwrap">
        <table className="box">
          <thead><tr><th>Player</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th className="hide-sm">STL</th><th className="hide-sm">BLK</th><th>FG%</th><th>3P%</th><th className="hide-sm">FT%</th></tr></thead>
          <tbody>
            {rows.filter((r) => r.gp > 0).map((r) => (
              <tr key={r.player_id}>
                <td style={{ fontWeight: 600 }}><Link to={`${base}/player/${r.player_id}`}>{r.display_name}</Link>{r.gs > 0 && <span className="muted sm"> {r.gs} GS</span>}</td>
                <td>{r.gp}</td><td>{d(r.min, r.gp)}</td><td style={{ fontWeight: 700 }}>{d(r.pts, r.gp)}</td><td>{d(r.reb, r.gp)}</td><td>{d(r.ast, r.gp)}</td>
                <td className="hide-sm">{d(r.stl, r.gp)}</td><td className="hide-sm">{d(r.blk, r.gp)}</td>
                <td>{pctS(r.fgm, r.fga)}</td><td>{pctS(r.tpm, r.tpa)}</td><td className="hide-sm">{pctS(r.ftm, r.fta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DiamondRoster({ rows, loading }: { rows: DiamondLine[]; loading: boolean }) {
  const { base } = useCtx();
  const [view, setView] = useState<'bat' | 'pit'>('bat');
  if (loading) return <Loading rows={6} />;
  if (!rows.length) return <p className="muted">Player stats appear after box scores are processed.</p>;
  const N = (v: any) => Number(v) || 0;
  const avg = (h: number, ab: number) => (N(ab) ? (N(h) / N(ab)).toFixed(3).replace(/^0/, '') : '–');
  const obp = (r: DiamondLine) => { const d = N(r.ab) + N(r.bb); return d ? ((N(r.h) + N(r.bb)) / d).toFixed(3).replace(/^0/, '') : '–'; };
  const era = (r: DiamondLine, inn: number) => (N(r.ip) ? ((N(r.er) * inn) / N(r.ip)).toFixed(2) : '–');
  const ipFmt = (v: number) => { const x = N(v); const f = Math.floor(x + 1e-6); return `${f}.${Math.round((x - f) * 3)}`; };
  const bat = rows.filter((r) => N(r.ab) + N(r.bb) > 0).sort((a, b) => N(b.ab) - N(a.ab));
  const pit = rows.filter((r) => N(r.ip) > 0).sort((a, b) => N(b.ip) - N(a.ip));
  return (
    <>
      <div className="chips">
        <button className={`chip ${view === 'bat' ? 'on' : ''}`} onClick={() => setView('bat')}>Hitting</button>
        <button className={`chip ${view === 'pit' ? 'on' : ''}`} onClick={() => setView('pit')}>Pitching</button>
      </div>
      <div className="tblwrap">
        {view === 'bat' ? (
          <table className="box">
            <thead><tr><th>Player</th><th>G</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>AVG</th><th>OBP</th></tr></thead>
            <tbody>{bat.map((r) => <tr key={r.player_id}><td style={{ fontWeight: 600 }}><Link to={`${base}/player/${r.player_id}`}>{r.display_name}</Link></td><td>{r.g_bat}</td><td>{N(r.ab)}</td><td>{N(r.r)}</td><td>{N(r.h)}</td><td>{N(r.rbi)}</td><td>{N(r.bb)}</td><td>{N(r.so)}</td><td style={{ fontWeight: 700 }}>{avg(r.h, r.ab)}</td><td>{obp(r)}</td></tr>)}</tbody>
          </table>
        ) : (
          <table className="box">
            <thead><tr><th>Pitcher</th><th>G</th><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>K</th><th>ERA</th></tr></thead>
            <tbody>{pit.map((r) => <tr key={r.player_id}><td style={{ fontWeight: 600 }}><Link to={`${base}/player/${r.player_id}`}>{r.display_name}</Link></td><td>{r.g_pit}</td><td>{ipFmt(r.ip)}</td><td>{N(r.ha)}</td><td>{N(r.er)}</td><td>{N(r.bba)}</td><td>{N(r.k)}</td><td style={{ fontWeight: 700 }}>{era(r, 9)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

const CFB_GROUPS: [string, string, [string, string][]][] = [
  ['passing', 'Passing', [['completions', 'CMP'], ['passingAttempts', 'ATT'], ['passingYards', 'YDS'], ['passingTouchdowns', 'TD'], ['interceptions', 'INT']]],
  ['rushing', 'Rushing', [['rushingAttempts', 'CAR'], ['rushingYards', 'YDS'], ['rushingTouchdowns', 'TD'], ['longRushing', 'LONG']]],
  ['receiving', 'Receiving', [['receptions', 'REC'], ['receivingYards', 'YDS'], ['receivingTouchdowns', 'TD'], ['longReception', 'LONG']]],
  ['defensive', 'Defense', [['totalTackles', 'TKL'], ['soloTackles', 'SOLO'], ['sacks', 'SACK'], ['tacklesForLoss', 'TFL'], ['passesDefended', 'PD']]],
  ['interceptions', 'Interceptions', [['interceptions', 'INT'], ['interceptionYards', 'YDS'], ['interceptionTouchdowns', 'TD']]],
  ['kicking', 'Kicking', [['fieldGoalsMade', 'FGM'], ['fieldGoalAttempts', 'FGA'], ['extraPointsMade', 'XPM'], ['longFieldGoalMade', 'LONG']]],
];
function CfbRoster({ rows, loading }: { rows: CfbLine[]; loading: boolean }) {
  const { base } = useCtx();
  const [grp, setGrp] = useState('passing');
  if (loading) return <Loading rows={6} />;
  if (!rows.length) return <p className="muted">Player stats appear after box scores are processed.</p>;
  const def = CFB_GROUPS.find((g) => g[0] === grp) ?? CFB_GROUPS[0];
  const list = rows.filter((r) => r.stat_group === def[0]).sort((a, b) => (Number(b.totals[def[2][2]?.[0]] ?? b.totals[def[2][0][0]]) || 0) - (Number(a.totals[def[2][2]?.[0]] ?? a.totals[def[2][0][0]]) || 0));
  return (
    <>
      <div className="chips scroll">{CFB_GROUPS.map((g) => <button key={g[0]} className={`chip ${g[0] === def[0] ? 'on' : ''}`} onClick={() => setGrp(g[0])}>{g[1]}</button>)}</div>
      <div className="tblwrap"><table className="box">
        <thead><tr><th>Player</th><th>G</th>{def[2].map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
        <tbody>{list.map((r) => <tr key={r.player_id}><td style={{ fontWeight: 600 }}><Link to={`${base}/player/${r.player_id}`}>{r.display_name}</Link></td><td>{r.games}</td>{def[2].map(([k]) => <td key={k}>{r.totals[k] ?? '–'}</td>)}</tr>)}</tbody>
      </table></div>
    </>
  );
}
