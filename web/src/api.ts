const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string;

const cache = new Map<string, Promise<any>>();

// Reads are kept on the device (survives closing the tab) for 20 minutes, so opening the site again is instant.
// Each trip to the database costs ~half a second; the data only changes every three hours anyway. Older copies are
// shown if the network fails.
const TTL = 20 * 60 * 1000;
const skey = (path: string) => `api:${path}`;
function fromSession(path: string): any | undefined {
  try { const raw = localStorage.getItem(skey(path)); if (!raw) return; const { t, v } = JSON.parse(raw); if (Date.now() - t < TTL) return v; } catch { /* unavailable */ }
}
function stale(path: string): any | undefined {
  try { const raw = localStorage.getItem(skey(path)); return raw ? JSON.parse(raw).v : undefined; } catch { return undefined; }
}
function toSession(path: string, v: any) {
  try { const raw = JSON.stringify({ t: Date.now(), v }); if (raw.length < 800_000) localStorage.setItem(skey(path), raw); }
  catch { try { Object.keys(localStorage).filter((k) => k.startsWith('api:')).slice(0, 50).forEach((k) => localStorage.removeItem(k)); } catch { /* unavailable */ } }
}
export function rest<T = any>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const hit = fromSession(path);
    if (hit !== undefined) { cache.set(path, Promise.resolve(hit)); return cache.get(path)!; }
    const p = fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
      .then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); const v = await r.json(); toSession(path, v); return v; })
      .catch((e) => { const old = stale(path); if (old !== undefined) return old; throw e; });
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
  // Market line (median of sportsbooks; spread from the home team's view, negative = home favored).
  spread?: number | string | null; total?: number | string | null; spread_open?: number | string | null; total_open?: number | string | null;
  home_ml?: number | null; away_ml?: number | null; line_books?: number | null;
}

// A bet we flagged: written before the game, graded after.
export interface Bet {
  id: number; sport_id: string; season_year: number; game_id: number; kind: 'live' | 'replay'; market: 'spread' | 'total' | 'moneyline' | 'prop';
  side: 'home' | 'away' | 'over' | 'under'; line: number; price: number | null; book: string | null; our_number: number; edge: number;
  cover_prob: number | null; tier: 'best' | 'strong' | 'lean' | null; reasons: { key: string; text: string }[]; made_at: string;
  close_line: number | null; clv: number | null; result: 'win' | 'loss' | 'push' | 'void' | null; graded_at: string | null;
  start_time: string; completed: boolean; status: string; home_score: number | null; away_score: number | null; neutral_site: boolean;
  home_name: string; home_abbr: string; home_logo: string | null; away_name: string; away_abbr: string; away_logo: string | null;
}
export const toBet = (b: any): Bet => ({ ...b, line: Number(b.line), our_number: Number(b.our_number), edge: Number(b.edge),
  cover_prob: b.cover_prob == null ? null : Number(b.cover_prob), close_line: b.close_line == null ? null : Number(b.close_line), clv: b.clv == null ? null : Number(b.clv) });

export const num = (v: any) => (v == null ? NaN : Number(v));

export function ratingsFor(sport: string, season: number) {
  return restAll<Rating>(`v_ratings_latest?sport_id=eq.${sport}&season_year=eq.${season}&order=rank.asc`).then((rows) =>
    rows.map((r) => ({ ...r, adj_off: num(r.adj_off), adj_def: num(r.adj_def), adj_em: num(r.adj_em), tempo: num(r.tempo), raw_off: num(r.raw_off), raw_def: num(r.raw_def) })));
}

// A handful of teams' ratings (for picks on a few games) without the whole list.
export function ratingsForTeams(sport: string, season: number, ids: number[]) {
  if (!ids.length) return Promise.resolve([] as Rating[]);
  return rest<Rating[]>(`v_ratings_latest?sport_id=eq.${sport}&season_year=eq.${season}&team_id=in.(${[...new Set(ids)].join(',')})`).then((rows) =>
    rows.map((r) => ({ ...r, adj_off: num(r.adj_off), adj_def: num(r.adj_def), adj_em: num(r.adj_em), tempo: num(r.tempo), raw_off: num(r.raw_off), raw_def: num(r.raw_def) })));
}
// League averages without the whole list: just the two columns, which is a few KB.
export function leagueFor(sport: string, season: number) {
  return rest<{ adj_off: number; tempo: number }[]>(`v_ratings_latest?select=adj_off,tempo&sport_id=eq.${sport}&season_year=eq.${season}&limit=1000`).then((r) => {
    const n = r.length || 1;
    return { off: r.reduce((a, x) => a + num(x.adj_off), 0) / n, tempo: r.reduce((a, x) => a + num(x.tempo), 0) / n, n: r.length };
  });
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
