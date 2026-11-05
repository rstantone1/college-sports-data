const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string;

const cache = new Map<string, Promise<any>>();

export function rest<T = any>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
      .then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path)!;
}

// Page through results beyond PostgREST's 1000-row cap.
export async function restAll<T = any>(path: string, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += page) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await rest<T[]>(`${path}${sep}limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export interface Rating {
  team_id: number; sport_id: string; season_year: number; as_of: string; games_played: number;
  adj_off: number; adj_def: number; adj_em: number; tempo: number; raw_off: number; raw_def: number;
  rank: number; off_rank: number; def_rank: number;
  display_name: string; short_name: string; mascot: string; abbreviation: string; color: string | null; alt_color: string | null;
  logo_url: string | null; conference_id: number | null; conference_name: string | null; conference_short: string | null; team_espn_id?: string | null;
}

export interface Game {
  id: number; espn_id: string; sport_id: string; season_year: number; season_type: number | null; start_time: string;
  status: string; completed: boolean; neutral_site: boolean; conference_game: boolean | null;
  venue_name: string | null; venue_city: string | null; venue_state: string | null; attendance: number | null;
  home_team_id: number; away_team_id: number; home_score: number | null; away_score: number | null; notes: string | null;
  home_name: string; home_abbr: string; home_color: string | null; home_logo: string | null;
  away_name: string; away_abbr: string; away_color: string | null; away_logo: string | null;
}

export const num = (v: any) => (v == null ? NaN : Number(v));

export function ratingsFor(sport: string, season: number) {
  return restAll<Rating>(`v_ratings_latest?sport_id=eq.${sport}&season_year=eq.${season}&order=rank.asc`).then((rows) =>
    rows.map((r) => ({ ...r, adj_off: num(r.adj_off), adj_def: num(r.adj_def), adj_em: num(r.adj_em), tempo: num(r.tempo), raw_off: num(r.raw_off), raw_def: num(r.raw_def) })));
}

export async function previousRanks(sport: string, season: number, asOf: string): Promise<Map<number, number>> {
  const d = await rest<{ as_of: string }[]>(`ratings?select=as_of&sport_id=eq.${sport}&season_year=eq.${season}&as_of=lt.${asOf}&order=as_of.desc&limit=1`);
  if (!d[0]) return new Map();
  const rows = await restAll<{ team_id: number; rank: number }>(`ratings?select=team_id,rank&sport_id=eq.${sport}&season_year=eq.${season}&as_of=eq.${d[0].as_of}`);
  return new Map(rows.map((r) => [r.team_id, r.rank]));
}

export async function seasonsWithRatings(sport: string): Promise<number[]> {
  const rows = await rest<{ season_year: number }[]>(`ratings?select=season_year&sport_id=eq.${sport}&order=season_year.desc&limit=1000`);
  return [...new Set(rows.map((r) => r.season_year))];
}
