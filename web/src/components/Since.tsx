import { Link } from 'react-router-dom';
import { rest, ratingsFor, type Game } from '../api';
import { useAsync, lastVisit, type Follow } from '../hooks';
import { sportMeta } from '../sports';

// "Since you were last here": what happened to the teams you follow while you were away. Only shows when there is
// something to say, and only for people who follow teams (it needs to know whose results to look up).
export function SinceLastVisit({ follows }: { follows: Follow[] }) {
  const from = lastVisit ? Math.max(lastVisit, Date.now() - 14 * 864e5) : null;
  const away = from != null && Date.now() - from > 3 * 3600e3;
  const key = follows.map((f) => `${f.sport}:${f.team_id}`).join(',');
  const data = useAsync(async () => {
    if (!away || !from) return [];
    const iso = new Date(from).toISOString(), day = iso.slice(0, 10);
    const rows = await Promise.all(follows.map(async (f) => {
      const season = sportMeta(f.sport).seasons[0].year;
      const [games, then, now] = await Promise.all([
        rest<Game[]>(`v_games?sport_id=eq.${f.sport}&season_year=eq.${season}&completed=eq.true&start_time=gte.${iso}&or=(home_team_id.eq.${f.team_id},away_team_id.eq.${f.team_id})&order=start_time.desc&limit=3`),
        rest<{ rank: number }[]>(`ratings?select=rank&sport_id=eq.${f.sport}&season_year=eq.${season}&team_id=eq.${f.team_id}&as_of=lte.${day}&order=as_of.desc&limit=1`),
        ratingsFor(f.sport, season),
      ]);
      const me = now.find((r) => r.team_id === f.team_id);
      const results = games.filter((g) => g.home_score != null && g.home_score !== g.away_score).map((g) => {
        const home = g.home_team_id === f.team_id;
        const us = home ? g.home_score! : g.away_score!, them = home ? g.away_score! : g.home_score!;
        return { won: us > them, text: `${us > them ? 'Beat' : 'Lost to'} ${home ? g.away_name : g.home_name} ${Math.max(us, them)}-${Math.min(us, them)}` };
      });
      const moved = me && then[0] ? then[0].rank - me.rank : 0;
      return { f, season, results, moved, rank: me?.rank };
    }));
    return rows.filter((r) => r.results.length || Math.abs(r.moved) >= 2);
  }, [key, from, away]);

  const rows = data.data ?? [];
  if (!away || !rows.length) return null;
  const when = new Date(from!);
  const label = Date.now() - from! < 6 * 864e5 ? when.toLocaleDateString(undefined, { weekday: 'long' }) : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <section className="since">
      <h2>Since you were last here <span className="muted">· {label}</span></h2>
      <div className="since-list">
        {rows.slice(0, 6).map(({ f, season, results, moved, rank }) => (
          <Link key={`${f.sport}:${f.team_id}`} to={`/${f.sport}/${season}/team/${f.team_id}`} className="since-row">
            {f.logo && <img src={f.logo} alt="" width={30} height={30} />}
            <div>
              <b>{f.name}</b> <span className="muted sm">{sportMeta(f.sport).short}</span>
              {results.map((r, i) => <div key={i} className={r.won ? 'W' : 'L'}>{r.text}</div>)}
              {Math.abs(moved) >= 2 && <div className="muted">{moved > 0 ? `Up ${moved} spots to #${rank}` : `Down ${-moved} spots to #${rank}`}</div>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
