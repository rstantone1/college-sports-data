// One shared playoff picture for the board, the picker and the team pages: the data, the user's picks, and the
// latest simulation. Picks live in the page address so a scenario can be sent to someone.
import { useSyncExternalStore } from 'react';
import { ratingsFor, restFresh, type Game, type Rating } from '../api';
import { buildPack, type LiveGame, type CfpRelease } from './pack';
import type { Pack, Locks, Result, Chalk } from './sim';
import type { DrawStep, SeedPath, TitleRoad } from './worker';

export interface Ripple { title: string; moves: { team: number; from: number; to: number }[]; at: number }
export interface State {
  status: 'loading' | 'ready' | 'error'; error?: string;
  season: number; pack: Pack | null; base: Result | null; cur: Result | null; chalk: Chalk | null;
  locks: Locks; chaos: number; busy: boolean; live: number; updated: number; cfpDate: number | null; ripple: Ripple | null;
}
let S: State = { status: 'loading', season: 0, pack: null, base: null, cur: null, chalk: null, locks: {}, chaos: 1, busy: false, live: 0, updated: 0, cfpDate: null, ripple: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { S = { ...S, ...p }; subs.forEach((f) => f()); };
export const usePlayoff = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => S);
export const getState = () => S;

let worker: Worker | null = null, seq = 0; const waiting = new Map<number, (v: any) => void>();
function call<T = any>(type: string, body: any): Promise<T> {
  if (!worker) { worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data.out); }; }
  const id = ++seq; return new Promise((res) => { waiting.set(id, res); worker!.postMessage({ id, type, body }); });
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
async function fetchLive(): Promise<LiveGame[]> {
  try {
    const sb = await (await fetch(`${ESPN}/scoreboard?groups=80&limit=300`, { cache: 'no-store' })).json();
    return (sb.events ?? []).map((e: any) => { const k = e.competitions[0], st = k.status, H = k.competitors.find((x: any) => x.homeAway === 'home'), A = k.competitors.find((x: any) => x.homeAway === 'away');
      const played = (Math.min(4, Math.max(0, (st.period ?? 1) - 1)) * 900 + (900 - (st.clock ?? 900))) / 3600;
      return { espnId: String(e.id), state: st.type.completed ? 'final' : st.type.state === 'in' ? 'live' : 'pre', hs: Number(H?.score ?? 0), as: Number(A?.score ?? 0), frac: (st.period ?? 1) > 4 ? 0.02 : Math.max(0.01, 1 - played), detail: st.type.shortDetail ?? '' } as LiveGame; });
  } catch { return []; }
}
// The committee's latest ranking: our own saved copy, or ESPN's feed if that's newer (or ours isn't there yet).
async function fetchCfp(season: number): Promise<CfpRelease | null> {
  let db: CfpRelease | null = null, es: CfpRelease | null = null;
  try { const rows = await restFresh<{ released_at: string; team_id: number; rank: number }>(`committee_rankings?sport_id=eq.cfb&season_year=eq.${season}&select=released_at,team_id,rank&order=released_at.desc`, 60);
    if (rows.length) { const d = rows[0].released_at; db = { date: +new Date(d), ranks: rows.filter((r) => r.released_at === d).map((r) => ({ teamId: Number(r.team_id), rank: r.rank })) }; } } catch { /* table not there yet */ }
  try { const rk = await (await fetch(`${ESPN}/rankings`, { cache: 'no-store' })).json(); const c = (rk.rankings ?? []).find((x: any) => x.type === 'cfp');
    if (c?.ranks?.length && Number(c.season?.year ?? season) === season) es = { date: +new Date(c.date), ranks: c.ranks.map((k: any) => ({ espnId: String(k.team.id), rank: k.current })) }; } catch { /* can't reach it from here */ }
  return es && (!db || es.date > db.date) ? es : db;
}

let baseChalk: Chalk | null = null;
let ratings: Rating[] = [], games: Game[] = [], cfp: CfpRelease | null = null, timer: any = null, lastDb = 0, runId = 0;
const GAME_COLS = 'id,espn_id,season_type,start_time,status,completed,neutral_site,home_team_id,away_team_id,home_score,away_score,notes';

async function rebuild(live: LiveGame[], why?: string) {
  const pack = buildPack(S.season, ratings, games, cfp, live);
  // Drop picks for games that have since been decided.
  const keys = new Set(pack.games.map((g) => g.key)); const locks: Locks = {}; for (const [k, v] of Object.entries(S.locks)) if (k.startsWith('t:') || keys.has(k)) locks[k] = v;
  const { committee, ...plain } = pack; await call('pack', { pack: plain, anchored: !!cfp });
  const prev = S.base; const mine = ++runId;
  const base = await call<{ result: Result; chalk: Chalk }>('sim', { locks: {}, chaos: 1 });
  if (mine !== runId) return;
  baseChalk = base.chalk;
  let ripple = S.ripple;
  if (why && prev && S.pack) ripple = diff(S.pack, pack, prev, base.result, why) ?? ripple;
  set({ status: 'ready', pack, base: base.result, locks, live: live.filter((x) => x.state === 'live').length, updated: Date.now(), cfpDate: cfp?.date ?? null, ripple });
  await rerun();
}
// Biggest movers between two results (matched by team id, since a rebuild can reorder nothing but be safe).
function diff(p0: Pack, p1: Pack, a: Result, b: Result, title: string): Ripple | null {
  const i0 = new Map(p0.teams.map((t, i) => [t.id, i])); const moves = p1.teams.map((t, i) => ({ team: i, from: a.make[i0.get(t.id) ?? i] ?? 0, to: b.make[i] })).filter((m) => Math.abs(m.to - m.from) >= 0.015).sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, 4);
  return moves.length ? { title, moves, at: Date.now() } : null;
}
async function rerun(title?: string) {
  if (!S.pack || !S.base) return;
  const n = Object.keys(S.locks).length; const mine = ++runId; const before = S.cur ?? S.base;
  if (!n && S.chaos === 1) { set({ cur: S.base, chalk: baseChalk, busy: false, ripple: title ? diff(S.pack, S.pack, before, S.base, title) : S.ripple }); return; }
  set({ busy: true });
  const r = await call<{ result: Result; chalk: Chalk }>('sim', { locks: S.locks, chaos: S.chaos });
  if (mine !== runId) return;
  set({ cur: r.result, chalk: r.chalk, busy: false, ripple: title ? diff(S.pack, S.pack, before, r.result, title) : S.ripple });
}

const loadGames = (season: number) => restFresh<Game>(`v_games?sport_id=eq.cfb&season_year=eq.${season}&select=${GAME_COLS}&order=start_time`);
// Every game that's over, from our database or the live scoreboard, whichever knows first.
function finals(live: LiveGame[]) { const m = new Map<string, boolean>(); const le = new Map(live.map((x) => [x.espnId, x]));
  for (const g of games) { if (g.completed && g.home_score != null && g.away_score != null) m.set(String(g.id), g.home_score > g.away_score); else { const l = le.get(String(g.espn_id)); if (l?.state === 'final') m.set(String(g.id), l.hs > l.as); } } return m; }
let known = new Map<string, boolean>(), stamp = '';
const stampOf = (live: LiveGame[]) => `${live.map((x) => `${x.espnId}:${x.state}:${x.hs}-${x.as}`).join('|')}#${known.size}#${cfp?.date ?? 0}`;

async function poll() {
  const live = await fetchLive(); const now = Date.now();
  const active = games.some((g) => !g.completed && +new Date(g.start_time) > now - 5 * 3600e3 && +new Date(g.start_time) < now + 20 * 60e3);
  const every = active ? (live.length ? 5 : 2.5) : 15;      // minutes; faster when the live scoreboard can't be reached
  if (now - lastDb > every * 60e3) { try { games = await loadGames(S.season); cfp = (await fetchCfp(S.season)) ?? cfp; lastDb = Date.now(); } catch { /* keep what we have */ } }
  const fin = finals(live); const fresh = [...fin.keys()].filter((k) => !known.has(k)); known = fin;
  const s2 = stampOf(live); if (s2 === stamp) return; stamp = s2;
  let why: string | undefined;
  if (fresh.length === 1) { const g = games.find((x) => String(x.id) === fresh[0]); const name = (id: number) => ratings.find((r) => r.team_id === id)?.short_name; const hw = fin.get(fresh[0])!;
    const w = g && name(hw ? g.home_team_id : g.away_team_id), l = g && name(hw ? g.away_team_id : g.home_team_id); why = w && l ? `Final: ${w} beat ${l}` : w ? `Final: ${w} won` : undefined; }
  else if (fresh.length > 1) why = `${fresh.length} games just went final`;
  await rebuild(live, why);
}

export async function init(season: number) {
  if (S.season === season && S.status !== 'error') return;
  set({ status: 'loading', season, locks: readLocks(), ripple: null });
  try {
    [ratings, games, cfp] = await Promise.all([ratingsFor('cfb', season), loadGames(season), fetchCfp(season)]);
    lastDb = Date.now();
    const live = await fetchLive(); known = finals(live); stamp = stampOf(live);
    await rebuild(live);
    clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 45e3);
  } catch (e: any) { set({ status: 'error', error: String(e?.message ?? e) }); }
}

// Picks <-> address: "s=<gameId>h,<gameId>a,t<conf>-<teamId>".
function readLocks(): Locks { try { const s = new URLSearchParams(location.search).get('s'); pendingRaw = s ?? ''; } catch { /* none */ } return {}; }
let pendingRaw = '';
export function hydrateLocks() {   // called once the pack exists, so ids can be turned into team indexes
  if (!pendingRaw || !S.pack) return; const p = S.pack; const locks: Locks = {};
  for (const part of pendingRaw.split(',')) { const t = part.match(/^t(\d+)-(\d+)$/); if (t) { const i = p.teams.findIndex((x) => x.id === Number(t[2])); if (i >= 0 && p.confs[Number(t[1])]) locks[`t:${t[1]}`] = i; continue; }
    const m = part.match(/^(\d+)([ha])$/); if (!m) continue; const g = p.games.find((x) => x.key === m[1]); if (g) { const w = m[2] === 'h' ? g.h : g.a; if (w >= 0) locks[g.key] = w; } }
  pendingRaw = ''; if (Object.keys(locks).length) { set({ locks }); rerun(); }
}
export function shareUrl(): string {
  const p = S.pack; if (!p) return location.href; const parts: string[] = [];
  for (const [k, v] of Object.entries(S.locks)) { if (k.startsWith('t:')) parts.push(`t${k.slice(2)}-${p.teams[v].id}`); else { const g = p.games.find((x) => x.key === k); if (g) parts.push(`${k}${g.h === v ? 'h' : 'a'}`); } }
  const u = new URL(location.href); u.pathname = u.pathname.replace(/\/playoff.*$/, '/playoff'); if (parts.length) u.searchParams.set('s', parts.join(',')); else u.searchParams.delete('s'); return u.toString();
}
const syncUrl = () => { try { const u = new URL(shareUrl()); history.replaceState(history.state, '', location.pathname + (u.search || '')); } catch { /* fine */ } };

export function pick(key: string, win: number | null, title?: string) { const locks = { ...S.locks }; if (win == null || locks[key] === win) delete locks[key]; else locks[key] = win; set({ locks }); syncUrl(); rerun(title); }
export function setLocks(locks: Locks, title?: string) { set({ locks }); syncUrl(); return rerun(title); }
export function reset() { set({ locks: {}, chaos: 1, ripple: null }); syncUrl(); rerun(); }
export function setChaos(chaos: number) { set({ chaos }); rerun(); }
export const clearRipple = () => set({ ripple: null });
export const teamScenario = (team: number) => call<{ left: number; pWin: number; winout: { make: number; bye: number }; loseone: { make: number; bye: number } | null }>('team', { team, locks: S.locks, chaos: S.chaos });
export const drawItUp = (team: number) => call<{ start: number; steps: DrawStep[] }>('draw', { team, locks: S.locks, chaos: S.chaos });
export const titleRoad = (team: number) => call<TitleRoad | null>('title', { team, locks: S.locks, chaos: S.chaos });
export const seedPaths = (team: number) => call<{ games: string[]; rows: SeedPath[] }>('paths', { team, locks: S.locks, chaos: S.chaos });
// What every undecided game does to these teams' chance to make the field (no picks applied).
export interface Tonight { make: number[]; games: number[]; d: number[] }
export const tonight = (teams: number[]) => call<Tonight>('tonight', { teams });
export const randomSeason = () => call<{ picks: Locks }>('season', { locks: S.locks, seed: Math.floor(Math.random() * 1e9) });
