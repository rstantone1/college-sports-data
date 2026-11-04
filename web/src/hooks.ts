import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ratingsFor, type Rating } from './api';
import { sportMeta } from './sports';

export function useCtx() {
  const p = useParams();
  const meta = sportMeta(p.sport);
  const sport = meta.id;
  const season = Number(p.season) || meta.seasons[0].year;
  return { sport, season, meta, base: `/${sport}/${season}` };
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

// Two team colors that can be told apart: if they're too close, the second team uses its alternate (or a fallback).
export function distinctPair(a?: string | null, b?: string | null, bAlt?: string | null): [string, string] {
  const ca = teamColor(a, '#2453D6');
  const rgb = (h: string) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const far = (x: string, y: string) => { const [p, q] = [rgb(x), rgb(y)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 90; };
  for (const c of [b, bAlt, 'E4312B', '147A4B']) {
    if (!c) continue;
    const cc = teamColor(c);
    if (far(ca, cc) && !/^#?(f{6}|ffffff)$/i.test(cc)) return [ca, cc];
  }
  return [ca, '#E4312B'];
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
