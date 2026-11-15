// Basketball tournament simulations, off the main thread.
import { simulate, type BPack, type BLocks, type BResult } from './sim';
let pack: BPack | null = null;
export interface LinePath { keys: string[]; wins: boolean[]; p: number; make: number; mode: number; dist: number[] }
function paths(p: BPack, locks: BLocks, team: number) {
  const mine = p.games.filter((g) => (g.h === team || g.a === team) && !(g.key in locks)).slice(0, 3); const T = p.teams.length; const rows: LinePath[] = [];
  for (let m = (1 << mine.length) - 1; m >= 0; m--) {
    const cur: BLocks = { ...locks }; const wins: boolean[] = []; let pr = 1;
    mine.forEach((g, i) => { const w = !!(m & (1 << (mine.length - 1 - i))); wins.push(w); const opp = g.h === team ? g.a : g.h; if (w) cur[g.key] = team; else if (opp >= 0) cur[g.key] = opp; const pw = g.h === team ? g.p : 1 - g.p; pr *= w ? pw : 1 - pw; });
    const r = simulate(p, { runs: 1000, locks: cur, keep: true }); const dist = new Array(18).fill(0); for (let s = 0; s < r.runs; s++) dist[r.seedRun![s * T + team]]++;
    let mode = 0, best = 0; for (let k = 1; k <= 16; k++) if (dist[k] > best) { best = dist[k]; mode = k; }
    rows.push({ keys: mine.map((g) => g.key), wins, p: pr, make: 1 - dist[0] / r.runs, mode, dist: dist.map((x) => x / r.runs) });
  }
  return { games: mine.map((g) => g.key), rows };
}
self.onmessage = (e: MessageEvent) => {
  const { id, type, body } = e.data; let out: any = null;
  if (type === 'pack') { pack = body.pack; out = true; }
  else if (pack && type === 'sim') { const r: BResult = simulate(pack, { runs: 2500, locks: body.locks, keep: true }); const { outcomes, seedRun, ...rest } = r; out = rest; }
  else if (pack && type === 'tonight') { const r = simulate(pack, { runs: 2500, locks: {}, keep: true, focus: body.teams }); out = { make: body.teams.map((t: number) => r.make[t]), games: r.lev?.games ?? [], d: r.lev ? Array.from(r.lev.d) : [] }; }
  else if (type === 'whatif') { const a = simulate(body.a, { runs: 4000, locks: {} }), b = simulate(body.b, { runs: 4000, locks: {} }), t = body.team; const pick = (r: BResult) => ({ make: r.make[t], reach: r.reach.map((x) => x[t]), expW: r.expW[t] }); out = { with: pick(a), without: pick(b) }; }
  else if (pack && type === 'paths') out = paths(pack, body.locks, body.team);
  (self as any).postMessage({ id, out });
};
