// Thin, polite client for ESPN's public JSON. Every response is cached in raw_payloads so
// parsers can be re-run later without touching the network.
import { q } from './db.js';
import type { SportConfig } from './sports.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const DELAY = Number(process.env.FETCH_DELAY_MS ?? 350);
const UA = 'college-sports-data/0.1 (research; contact via repo)';

let last = 0;
async function pace() {
  const wait = last + DELAY - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function getJson(url: string, attempt = 1): Promise<any> {
  await pace();
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`ESPN ${res.status} after ${attempt} tries: ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt * attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${url}`);
  return res.json();
}

// Fetch with cache. `fresh` forces a network hit (use for scoreboards of recent dates).
export async function cached(kind: string, key: string, url: string, fresh = false): Promise<any> {
  if (!fresh) {
    const hit = await q<{ payload: any }>(
      `select payload from raw_payloads where source='espn' and kind=$1 and key=$2`, [kind, key]);
    if (hit[0]) return hit[0].payload;
  }
  let payload = await getJson(url);
  if (kind === 'summary') payload = trimSummary(payload);
  await q(
    `insert into raw_payloads(source, kind, key, payload) values ('espn', $1, $2, $3)
     on conflict (source, kind, key) do update set payload = excluded.payload, fetched_at = now()`,
    [kind, key, JSON.stringify(payload)]);
  return payload;
}

export const espn = {
  teams: (s: SportConfig) =>
    cached('teams', s.id, `${BASE}/${s.espnPath}/teams?limit=1000${s.espnGroups ? `&groups=${s.espnGroups}` : ''}`, true),
  scoreboard: (s: SportConfig, yyyymmdd: string, fresh: boolean) =>
    cached('scoreboard', `${s.id}:${yyyymmdd}`,
      `${BASE}/${s.espnPath}/scoreboard?dates=${yyyymmdd}&limit=500${s.espnGroups ? `&groups=${s.espnGroups}` : ''}`, fresh),
  summary: (s: SportConfig, eventId: string, fresh = false) =>
    cached('summary', `${s.id}:${eventId}`, `${BASE}/${s.espnPath}/summary?event=${eventId}`, fresh),
  roster: (s: SportConfig, teamEspnId: string, fresh = true) =>
    cached('roster', `${s.id}:${teamEspnId}`, `${BASE}/${s.espnPath}/teams/${teamEspnId}/roster`, fresh),
  // Conference membership for a season. Different host path (apis/v2) than the rest.
  standings: (s: SportConfig, seasonYear: number) =>
    cached('standings', `${s.id}:${seasonYear}`,
      `https://site.api.espn.com/apis/v2/sports/${s.espnPath}/standings?season=${seasonYear}${s.espnGroups ? `&group=${s.espnGroups}` : ''}`, true),
};

// "19-62" -> {made:19, attempted:62}; "31" -> 31; "" -> null
export function parseStat(name: string, display: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (display == null || display === '' || display === '--') return out;
  if (name.includes('-') && display.includes('-')) {
    const [a, b] = name.split('-');
    const [x, y] = display.split('-').map(Number);
    if (Number.isFinite(x)) out[a] = x;
    if (Number.isFinite(y)) out[b] = y;
    return out;
  }
  const v = Number(display);
  if (Number.isFinite(v)) out[name] = v;
  return out;
}

// Keep only the parts of a game summary we parse. News, video, odds widgets and standings are dropped.
const KEEP = ['header', 'boxscore', 'gameInfo', 'plays', 'drives', 'leaders', 'format'];
function trimSummary(p: any) {
  if (!p || typeof p !== 'object') return p;
  const out: any = {};
  for (const k of KEEP) if (k in p) out[k] = p[k];
  if (out.header?.competitions) {
    for (const c of out.header.competitions) { delete c.broadcasts; delete c.odds; delete c.tickets; delete c.geoBroadcasts; }
  }
  return out;
}
