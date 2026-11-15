// Shared state for the basketball tournament picture (one sport at a time).
import { useSyncExternalStore } from 'react';
import { ratingsFor, restFresh, type Game, type Rating } from '../api';
import { buildBracketPack } from './pack';
import type { BPack, BLocks, BResult } from './sim';
import type { LinePath } from './worker';

export interface Ripple { title: string; moves: { team: number; from: number; to: number }[]; at: number }
export interface BState { status: 'loading' | 'ready' | 'error'; error?: string; sport: string; season: number; pack: BPack | null; base: BResult | null; cur: BResult | null; locks: BLocks; busy: boolean; ripple: Ripple | null }
let S: BState = { status: 'loading', sport: '', season: 0, pack: null, base: null, cur: null, locks: {}, busy: false, ripple: null };
const subs = new Set<() => void>(); const set = (p: Partial<BState>) => { S = { ...S, ...p }; subs.forEach((f) => f()); };
export const useBracket = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => S);
let worker: Worker | null = null, seq = 0, runId = 0; let raw: { ratings: Rating[]; games: Game[] } | null = null; const waiting = new Map<number, (v: any) => void>();
function call<T = any>(type: string, body: any): Promise<T> {
  if (!worker) { worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data.out); }; }
  const id = ++seq; return new Promise((res) => { waiting.set(id, res); worker!.postMessage({ id, type, body }); });
}
const COLS = 'id,season_type,start_time,status,completed,neutral_site,home_team_id,away_team_id,home_score,away_score';
export async function initBracket(sport: string, season: number) {
  if (S.sport === sport && S.season === season && S.status !== 'error') return;
  set({ status: 'loading', sport, season, pack: null, base: null, cur: null, locks: {}, ripple: null });
  try {
    const [ratings, games] = await Promise.all([ratingsFor(sport, season), restFresh<Game>(`v_games?sport_id=eq.${sport}&season_year=eq.${season}&select=${COLS}&order=start_time`)]);
    if (S.sport !== sport) return;
    raw = { ratings, games }; const pack = buildBracketPack(sport, season, ratings, games); await call('pack', { pack });
    const base = await call<BResult>('sim', { locks: {} }); if (S.sport !== sport) return;
    set({ status: 'ready', pack, base, cur: base });
  } catch (e: any) { set({ status: 'error', error: String(e?.message ?? e) }); }
}
async function rerun(title?: string) {
  if (!S.pack || !S.base) return; const mine = ++runId, before = S.cur ?? S.base;
  if (!Object.keys(S.locks).length) { set({ cur: S.base, busy: false, ripple: title ? diff(before, S.base, title) : S.ripple }); return; }
  set({ busy: true }); const r = await call<BResult>('sim', { locks: S.locks }); if (mine !== runId) return;
  set({ cur: r, busy: false, ripple: title ? diff(before, r, title) : S.ripple });
}
function diff(a: BResult, b: BResult, title: string): Ripple | null { const moves = Array.from(b.make, (to, team) => ({ team, from: a.make[team], to })).filter((m) => Math.abs(m.to - m.from) >= 0.03).sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, 4); return moves.length ? { title, moves, at: Date.now() } : null; }
export function pickB(key: string, win: number, title?: string) { const locks = { ...S.locks }; if (locks[key] === win) delete locks[key]; else locks[key] = win; set({ locks }); rerun(title); }
export function setLocksB(locks: BLocks, title?: string) { set({ locks }); return rerun(title); }
export function resetB() { set({ locks: {}, ripple: null }); rerun(); }
export const clearRippleB = () => set({ ripple: null });
export const linePaths = (team: number) => call<{ games: string[]; rows: LinePath[] }>('paths', { team, locks: S.locks });
// What the next few days' games do to these teams' chance to make the field (no picks applied).
export interface TonightB { make: number[]; games: number[]; d: number[] }
export const tonightB = (teams: number[]) => call<TonightB>('tonight', { teams });
// The same season with one team's rating moved by `shift` points per 100 possessions: tournament odds with and without.
export interface WhatIf { make: number; reach: number[]; expW: number }
export async function ratingWhatIf(teamId: number, shift: number): Promise<{ with: WhatIf; without: WhatIf } | null> {
  if (!raw || !S.pack) return null; const team = S.pack.teams.findIndex((t) => t.id === teamId); if (team < 0) return null;
  const moved = raw.ratings.map((r) => (r.team_id === teamId ? { ...r, adj_off: Number(r.adj_off) + shift / 2, adj_def: Number(r.adj_def) - shift / 2, adj_em: Number(r.adj_em) + shift } : r));
  return call('whatif', { team, a: S.pack, b: buildBracketPack(S.sport, S.season, moved, raw.games) });
}
