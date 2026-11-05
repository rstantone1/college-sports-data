import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ratingsFor, type Rating } from './api';
import { sportMeta } from './sports';

// The sport in the address, or (on pages that aren't about one sport, like Home) the last one the person looked at.
export function useCtx() {
  const p = useParams();
  let remembered: string | undefined;
  try { remembered = localStorage.getItem('lastSport') ?? undefined; } catch { /* unavailable */ }
  const meta = sportMeta(p.sport ?? remembered);
  const sport = meta.id;
  const season = Number(p.season) || meta.seasons[0].year;
  if (p.sport) { try { localStorage.setItem('lastSport', sport); } catch { /* unavailable */ } }
  return { sport, season, meta, base: `/${sport}/${season}`, inSport: !!p.sport };
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[]): { data: T | undefined; error: string | null; loading: boolean } {
  const [s, set] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let live = true;
    set((x) => ({ ...x, loading: true, error: null }));
    fn().then((data) => live && set({ data, error: null, loading: false }))
      .catch((e) => live && set({ data: undefined, error: String(e.message ?? e), loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export function useRatings() {
  const { sport, season } = useCtx();
  return useAsync<Rating[]>(() => ratingsFor(sport, season), [sport, season]);
}

export const teamColor = (c?: string | null, fallback = '#2453D6') => (c ? `#${c.replace('#', '')}` : fallback);

const isDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
const hexRgb = (h: string) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const lum = (h: string) => { const [r, g, b] = hexRgb(h); return (r * 299 + g * 587 + b * 114) / 255000; };
const mix = (h: string, to: number, t: number) => '#' + hexRgb(h).map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('');
// A team color that can be seen as text or a thin line on the page background: navy and black get lifted in
// dark mode, white and gold get grounded in light mode. Backgrounds (the team hero) keep the true color.
export function visibleColor(c?: string | null, fallback = '#2453D6') {
  const h = teamColor(c, fallback);
  const l = lum(h);
  if (isDark()) return l < 0.28 ? mix(h, 255, Math.min(0.6, (0.3 - l) * 2.2 + 0.25)) : h;
  return l > 0.72 ? mix(h, 0, Math.min(0.55, (l - 0.7) * 2 + 0.2)) : h;
}

// Two team colors that can be told apart: if they're too close, the second team uses its alternate (or a fallback).
export function distinctPair(a?: string | null, b?: string | null, bAlt?: string | null): [string, string] {
  const ca = teamColor(a, '#2453D6');
  const rgb = (h: string) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const far = (x: string, y: string) => { const [p, q] = [rgb(x), rgb(y)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 90; };
  for (const c of [b, bAlt, 'E4312B', '147A4B']) {
    if (!c) continue;
    const cc = teamColor(c);
    if (far(ca, cc) && !/^#?(f{6}|ffffff)$/i.test(cc)) return [visibleColor(ca), visibleColor(cc)];
  }
  return [visibleColor(ca), '#E4312B'];
}

// Readable text on a team color.
export function onColor(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#0B1220' : '#FFFFFF';
}

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(iso).toLocaleDateString(undefined, opts);
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* storage unavailable */ } };
  return [v, set];
}

// Teams the person follows. Lives on the device (no account); shared across tabs through a storage event.
export interface Follow { sport: string; season: number; team_id: number; name: string; logo: string | null }
const FOLLOW_KEY = 'follow:v1';
const readFollows = (): Follow[] => { try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '[]'); } catch { return []; } };
const followListeners = new Set<() => void>();
export function useFollows() {
  const [list, setList] = useState<Follow[]>(readFollows);
  useEffect(() => {
    const fn = () => setList(readFollows());
    followListeners.add(fn); window.addEventListener('storage', fn);
    return () => { followListeners.delete(fn); window.removeEventListener('storage', fn); };
  }, []);
  const write = (next: Follow[]) => { try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(next)); } catch { /* unavailable */ } followListeners.forEach((f) => f()); };
  const has = (sport: string, team_id: number) => list.some((f) => f.sport === sport && f.team_id === team_id);
  const toggle = (f: Follow) => write(has(f.sport, f.team_id) ? list.filter((x) => !(x.sport === f.sport && x.team_id === f.team_id)) : [...list, f].slice(-30));
  return { list, has, toggle };
}

// Where a value sits among its peers, 0-100. `higherIsBetter` false flips it so 100 is always good.
export function percentile(values: number[], v: number, higherIsBetter = true) {
  const xs = values.filter((x) => Number.isFinite(x));
  if (!xs.length || !Number.isFinite(v)) return null;
  const below = xs.filter((x) => (higherIsBetter ? x < v : x > v)).length;
  const equal = xs.filter((x) => x === v).length;
  return Math.round(((below + equal / 2) / xs.length) * 100);
}

// When the person was last here, before this visit. A visit ends after 30 quiet minutes; reloading inside one
// doesn't reset it. Lives on the device. Null on the very first visit.
const VISIT_KEY = 'visit:v1';
export const lastVisit: number | null = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(VISIT_KEY) ?? 'null') as { since: number | null; seen: number } | null;
    const now = Date.now();
    const since = raw ? (now - raw.seen > 30 * 60e3 ? raw.seen : raw.since) : null;
    const save = (seen: number) => { try { localStorage.setItem(VISIT_KEY, JSON.stringify({ since, seen })); } catch { /* unavailable */ } };
    save(now);
    setInterval(() => save(Date.now()), 5 * 60e3);
    return since;
  } catch { return null; }
})();
