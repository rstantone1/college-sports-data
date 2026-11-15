// The College Football Playoff committee's weekly ranking, from ESPN's public rankings feed. The playoff
// simulator starts every simulated season from where the committee has teams today, so each release is kept.
import { q } from '../db.js';

const URL = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings';

export async function ingestCommittee(seasonYear: number) {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`committee rankings: ${res.status}`); return; }
  const body: any = await res.json();
  const cfp = (body.rankings ?? []).find((r: any) => r.type === 'cfp');
  if (!cfp?.ranks?.length || !cfp.date) { console.log('committee rankings: none published yet'); return; }
  const released = new Date(cfp.date).toISOString();
  const teams = await q<{ id: string; espn_id: string }>(`select id, espn_id from teams where sport_id='cfb'`);
  const byEspn = new Map(teams.map((t) => [String(t.espn_id), Number(t.id)]));
  let n = 0;
  for (const k of cfp.ranks) {
    const id = byEspn.get(String(k.team?.id)); if (!id || !k.current) continue;
    await q(`insert into committee_rankings(sport_id, season_year, released_at, team_id, rank) values ('cfb',$1,$2,$3,$4)
             on conflict (sport_id, season_year, released_at, team_id) do update set rank = excluded.rank`, [seasonYear, released, id, k.current]);
    n++;
  }
  console.log(`committee rankings: ${n} teams, released ${released.slice(0, 10)}`);
}
