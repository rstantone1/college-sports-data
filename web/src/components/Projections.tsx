import { Link } from 'react-router-dom';
import { rest, type Game } from '../api';
import { useAsync } from '../hooks';

interface Proj { player_id: number; team_id: number; stat: string; projection: number | string; minutes: number | string | null }

// Our projected stat line for each regular player in an upcoming game. Shown before tip only; once the game
// starts, the real box score takes over.
export function Projections({ game, base }: { game: Game; base: string }) {
  const d = useAsync(async () => {
    const rows = await rest<Proj[]>(`player_projections?game_id=eq.${game.id}&kind=eq.live&select=player_id,team_id,stat,projection,minutes`);
    if (!rows.length) return null;
    const ids = [...new Set(rows.map((r) => r.player_id))];
    const names = await rest<{ id: number; display_name: string }[]>(`players?id=in.(${ids.join(',')})&select=id,display_name`);
    const nm = new Map(names.map((x) => [x.id, x.display_name]));
    const by = new Map<number, { id: number; tm: number; name: string; min: number; s: Record<string, number> }>();
    for (const r of rows) {
      const p = by.get(r.player_id) ?? { id: r.player_id, tm: r.team_id, name: nm.get(r.player_id) ?? '', min: Number(r.minutes ?? 0), s: {} };
      p.s[r.stat] = Number(r.projection); by.set(r.player_id, p);
    }
    return [...by.values()];
  }, [game.id]);
  if (game.completed || !d.data?.length) return null;
  const side = (tm: number, name: string) => {
    const ps = d.data!.filter((p) => p.tm === tm).sort((a, b) => b.min - a.min).slice(0, 8);
    if (!ps.length) return null;
    return (
      <div className="tblwrap" style={{ marginTop: 10 }}>
        <table className="box">
          <thead><tr><th>{name}</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th></tr></thead>
          <tbody>{ps.map((p) => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}><Link to={`${base}/player/${p.id}`}>{p.name}</Link></td>
              <td>{p.min.toFixed(0)}</td><td style={{ fontWeight: 700 }}>{(p.s.points ?? 0).toFixed(1)}</td>
              <td>{(p.s.rebounds ?? 0).toFixed(1)}</td><td>{(p.s.assists ?? 0).toFixed(1)}</td><td>{(p.s.threePointFieldGoalsMade ?? 0).toFixed(1)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  };
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3>Projected stat lines</h3>
      <p className="muted sm" style={{ margin: '0 0 4px' }}>What we expect from each player, from this season's games, the pace of this matchup and the defense they face. Single games swing a lot: a 15-point projection lands between about 9 and 21 two times in three.</p>
      {side(game.away_team_id, game.away_name)}
      {side(game.home_team_id, game.home_name)}
    </div>
  );
}
