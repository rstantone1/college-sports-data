import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rest, restAll, type Game } from '../api';
import { useAsync, useCtx, useRatings, teamColor, fmtDate, fmtTime } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { FlowChart, ShotChart } from '../components/Charts';
import { predict, league, pct } from '../model';

interface Play { sequence: number; period: number; clock: string; team_id: number | null; play_type: string; description: string; scoring_play: boolean; score_value: number; home_score: number; away_score: number; x: number | null; y: number | null; }
interface PLine { team_id: number; starter: boolean; did_not_play: boolean; stats: Record<string, number>; players: { display_name: string } }

export function GamePage() {
  const { gameId } = useParams();
  const id = Number(gameId);
  const { sport, base } = useCtx();
  const R = useRatings();
  const g = useAsync(() => rest<Game[]>(`v_games?id=eq.${id}`).then((r) => r[0]), [id]);
  const plays = useAsync(() => restAll<Play>(`plays?game_id=eq.${id}&order=sequence.asc&select=sequence,period,clock,team_id,play_type,description,scoring_play,score_value,home_score,away_score,x,y`), [id]);
  const box = useAsync(() => rest<PLine[]>(`game_player_stats?game_id=eq.${id}&select=team_id,starter,did_not_play,stats,players(display_name)&order=starter.desc`), [id]);

  const game = g.data;
  const regPer = sport === 'wbb' ? 4 : 2, perLen = sport === 'wbb' ? 10 : 20;

  const flow = useMemo(() => {
    if (!plays.data) return [];
    const out: { t: number; m: number }[] = [];
    for (const p of plays.data) {
      const [mm, ss] = (p.clock ?? '0:0').split(':').map(Number);
      const left = (mm || 0) + (ss || 0) / 60;
      const t = p.period <= regPer ? (p.period - 1) * perLen + (perLen - left) : regPer * perLen + (p.period - regPer - 1) * 5 + (5 - left);
      out.push({ t, m: (p.home_score ?? 0) - (p.away_score ?? 0) });
    }
    return out;
  }, [plays.data, regPer, perLen]);

  const shots = useMemo(() => {
    const m = new Map<number, { x: number; y: number; made: boolean; three: boolean }[]>();
    for (const p of plays.data ?? []) {
      if (p.x == null || p.y == null || !p.team_id) continue;
      if (!/\b(made|missed)\b/.test(p.description ?? '') || /free throw/i.test(p.description ?? '')) continue;
      if (!m.has(p.team_id)) m.set(p.team_id, []);
      m.get(p.team_id)!.push({ x: Number(p.x), y: Number(p.y), made: !!p.scoring_play, three: p.score_value === 3 });
    }
    return m;
  }, [plays.data]);

  if (g.loading || R.loading) return <Loading />;
  if (g.error || !game) return <ErrorBox msg={g.error ?? 'Game not found.'} />;

  const hc = teamColor(game.home_color, '#2453D6'), ac = teamColor(game.away_color, '#E4312B');
  const byId = new Map((R.data ?? []).map((r) => [r.team_id, r]));
  const H = byId.get(game.home_team_id), A = byId.get(game.away_team_id);
  const pred = H && A ? predict(H, A, league(R.data!), game.neutral_site ? 0 : 1, sport) : null;
  const final = game.completed && game.home_score != null;
  const homeWon = final && game.home_score! > game.away_score!;

  const side = (teamId: number, name: string) => {
    const lines = (box.data ?? []).filter((l) => l.team_id === teamId && !l.did_not_play);
    const t = (k: string) => lines.reduce((a, l) => a + (Number(l.stats[k]) || 0), 0);
    return (
      <div className="panel">
        <h3>{name}</h3>
        <div className="tblwrap">
          <table className="box">
            <thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>FG</th><th>3P</th><th>FT</th><th>REB</th><th>AST</th><th className="hide-sm">STL</th><th className="hide-sm">BLK</th><th className="hide-sm">TO</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: l.starter ? 700 : 500 }}>{l.players?.display_name}</td>
                  <td>{l.stats.minutes ?? '–'}</td><td style={{ fontWeight: 700 }}>{l.stats.points ?? 0}</td>
                  <td>{l.stats.fieldGoalsMade ?? 0}-{l.stats.fieldGoalsAttempted ?? 0}</td>
                  <td>{l.stats.threePointFieldGoalsMade ?? 0}-{l.stats.threePointFieldGoalsAttempted ?? 0}</td>
                  <td>{l.stats.freeThrowsMade ?? 0}-{l.stats.freeThrowsAttempted ?? 0}</td>
                  <td>{l.stats.rebounds ?? 0}</td><td>{l.stats.assists ?? 0}</td>
                  <td className="hide-sm">{l.stats.steals ?? 0}</td><td className="hide-sm">{l.stats.blocks ?? 0}</td><td className="hide-sm">{l.stats.turnovers ?? 0}</td>
                </tr>
              ))}
              {lines.length > 0 && (
                <tr className="tot"><td>Team</td><td></td><td>{t('points')}</td><td>{t('fieldGoalsMade')}-{t('fieldGoalsAttempted')}</td><td>{t('threePointFieldGoalsMade')}-{t('threePointFieldGoalsAttempted')}</td><td>{t('freeThrowsMade')}-{t('freeThrowsAttempted')}</td><td>{t('rebounds')}</td><td>{t('assists')}</td><td className="hide-sm">{t('steals')}</td><td className="hide-sm">{t('blocks')}</td><td className="hide-sm">{t('turnovers')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!lines.length && <p className="muted">No box score yet.</p>}
      </div>
    );
  };

  return (
    <>
      <Back />
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="muted sm" style={{ marginBottom: 8 }}>
          {fmtDate(game.start_time, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtTime(game.start_time)}
          {game.venue_name ? ` · ${game.venue_name}${game.venue_city ? `, ${game.venue_city}` : ''}` : ''}
          {game.attendance ? ` · ${game.attendance.toLocaleString()} fans` : ''}
          {game.notes ? ` · ${game.notes}` : ''}
        </div>
        <div className="score" style={{ flexWrap: 'wrap' }}>
          <Link to={`${base}/team/${game.away_team_id}`} style={{ textAlign: 'center', opacity: final && homeWon ? .55 : 1 }}>
            {game.away_logo && <img src={game.away_logo} alt="" width={56} height={56} style={{ objectFit: 'contain', display: 'block', margin: '0 auto' }} />}
            <div style={{ fontSize: 22 }}>{game.away_name}{A && <span className="muted" style={{ fontSize: 16 }}> #{A.rank}</span>}</div>
          </Link>
          <div className="s" style={{ color: ac }}>{game.away_score ?? '–'}</div>
          <div className="muted" style={{ fontSize: 22 }}>{final ? 'Final' : game.neutral_site ? 'vs' : '@'}</div>
          <div className="s" style={{ color: hc }}>{game.home_score ?? '–'}</div>
          <Link to={`${base}/team/${game.home_team_id}`} style={{ textAlign: 'center', opacity: final && !homeWon ? .55 : 1 }}>
            {game.home_logo && <img src={game.home_logo} alt="" width={56} height={56} style={{ objectFit: 'contain', display: 'block', margin: '0 auto' }} />}
            <div style={{ fontSize: 22 }}>{game.home_name}{H && <span className="muted" style={{ fontSize: 16 }}> #{H.rank}</span>}</div>
          </Link>
        </div>
        {pred && (
          <>
            <div className="prob" aria-label="Win probability using current ratings">
              <div style={{ flexBasis: `${(1 - pred.aWin) * 100}%`, background: ac }}>{pct(1 - pred.aWin)}</div>
              <div style={{ flexBasis: `${pred.aWin * 100}%`, background: hc, justifyContent: 'flex-end' }}>{pct(pred.aWin)}</div>
            </div>
            <p className="muted sm" style={{ textAlign: 'center', margin: 0 }}>
              Using today's ratings: {game.home_name} {Math.round(pred.aPts)}, {game.away_name} {Math.round(pred.bPts)} in about {Math.round(pred.poss)} possessions.
              {final && <> {(pred.aWin >= .5) === homeWon ? ' The favorite won.' : ' Upset.'}</>}
            </p>
          </>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>How the game unfolded</h3>
        {plays.loading ? <Loading rows={3} /> : <FlowChart series={flow} homeColor={hc} awayColor={ac} homeName={game.home_name} awayName={game.away_name} />}
      </div>

      {shots.size > 0 && (
        <div className="grid g2e" style={{ marginBottom: 16, display: 'grid' }}>
          <div className="panel"><h3>{game.away_name} shots</h3><ShotChart shots={shots.get(game.away_team_id) ?? []} color={ac} title={game.away_name} /></div>
          <div className="panel"><h3>{game.home_name} shots</h3><ShotChart shots={shots.get(game.home_team_id) ?? []} color={hc} title={game.home_name} /></div>
        </div>
      )}

      <div className="grid">
        {side(game.away_team_id, game.away_name)}
        {side(game.home_team_id, game.home_name)}
      </div>
    </>
  );
}
