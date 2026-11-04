import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rest, restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings, teamColor, onColor, fmtDate } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { LineChart } from '../components/Charts';
import { f1, sign, pct, predict, league } from '../model';

interface PlayerLine { player_id: number; display_name: string; gp: number; gs: number; min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number; }

export function TeamPage() {
  const { teamId } = useParams();
  const id = Number(teamId);
  const { sport, season, base } = useCtx();
  const R = useRatings();
  const games = useAsync(() => restAll<Game>(`v_games?season_year=eq.${season}&sport_id=eq.${sport}&or=(home_team_id.eq.${id},away_team_id.eq.${id})&order=start_time.asc`), [id, sport, season]);
  const players = useAsync(() => rest<PlayerLine[]>(`mv_player_season?team_id=eq.${id}&season_year=eq.${season}&order=pts.desc`), [id, season]);
  const hist = useAsync(() => restAll<{ as_of: string; adj_em: number; rank: number }>(`ratings?select=as_of,adj_em,rank&team_id=eq.${id}&season_year=eq.${season}&order=as_of.asc`), [id, season]);
  const [tab, setTab] = useState<'sched' | 'roster'>('sched');

  const me = R.data?.find((r) => r.team_id === id);
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  const L = useMemo(() => league(R.data ?? []), [R.data]);

  if (R.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;
  if (!me) return <><Back /><div className="panel empty">This team has no rating this season yet.</div></>;

  const color = teamColor(me.color, '#0B1220');
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
      <section className="hero" style={{ background: `linear-gradient(120deg, ${color} 0%, ${color} 55%, ${teamColor(me.alt_color, '#000')} 140%)`, color: ink }}>
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
        <div className="card"><div className="k">Margin</div><div className="v" style={{ color: me.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(me.adj_em)}</div><div className="r">per 100 possessions</div></div>
        <div className="card"><div className="k">Offense</div><div className="v">{f1(me.adj_off)}</div><div className="r">#{me.off_rank} nationally</div></div>
        <div className="card"><div className="k">Defense</div><div className="v">{f1(me.adj_def)}</div><div className="r">#{me.def_rank} nationally</div></div>
        <div className="card"><div className="k">Pace</div><div className="v">{f1(me.tempo)}</div><div className="r">possessions / game</div></div>
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
            <Roster rows={players.data ?? []} loading={players.loading} />
          )}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="panel">
            <h3>Rating over the season</h3>
            <LineChart color={color === '#FFFFFF' ? '#0B1220' : color}
              points={(hist.data ?? []).map((h) => ({ x: fmtDate(h.as_of + 'T12:00:00'), y: Number(h.adj_em) }))} yLabel="Margin over time" />
          </div>
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
                <td style={{ fontWeight: 600 }}>{r.display_name}{r.gs > 0 && <span className="muted sm"> {r.gs} GS</span>}</td>
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
