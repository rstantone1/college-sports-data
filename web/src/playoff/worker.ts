// Runs the simulations off the main thread so the page stays smooth while thousands of seasons play out.
import { simulate, chalk, type Pack, type Locks, type Result } from './sim';
import { COMMITTEE } from './config';

let pack: Pack | null = null;
const RUNS = 6000;

export interface DrawStep { key: string; win: number; after: number }
function draw(p: Pack, locks: Locks, team: number, chaos: number): { start: number; steps: DrawStep[] } {
  const cur: Locks = { ...locks }; const steps: DrawStep[] = [];
  const run = (keep = false) => simulate(p, { runs: 2500, locks: cur, chaos, keep });
  const start = run().make[team];
  // First what's in their own hands: win every game left, then the conference title if they can reach it.
  for (const g of p.games) if ((g.h === team || g.a === team) && !(g.key in cur)) { cur[g.key] = team; steps.push({ key: g.key, win: team, after: run().make[team] }); }
  const c = p.teams[team].conf;
  if (c >= 0 && p.confs[c].title && !(`t:${c}` in cur)) { const r = run(); if (r.titleGame[team] > 0.03 && r.make[team] < 0.97) { cur[`t:${c}`] = team; const rr = run(); if (!rr.rare) steps.push({ key: `t:${c}`, win: team, after: rr.make[team] }); else delete cur[`t:${c}`]; } }
  // Then the help they need from everyone else, biggest lift first.
  for (let i = 0; i < 6; i++) {
    const r = run(true); const lv = r.lev; if (!lv || r.make[team] >= 0.93) break;
    const ti = lv.teams.indexOf(team); if (ti < 0) break;
    let best = -1, bd = 0.02; for (let gi = 0; gi < lv.games.length; gi++) { const d = Math.abs(lv.d[gi * lv.teams.length + ti]); if (d > bd) { bd = d; best = gi; } }
    if (best < 0) break;
    const g = p.games[lv.games[best]]; const win = lv.d[best * lv.teams.length + ti] > 0 ? g.h : g.a;
    if (win < 0) { cur[g.key] = win; continue; }
    cur[g.key] = win; steps.push({ key: g.key, win, after: run().make[team] });
  }
  return { start, steps };
}

// Where a team lands for every way its remaining games can go: one simulation per combination of wins and losses,
// split again by whether it wins its conference title.
export interface SeedLine { n: number; make: number; bye: number; mode: number; lo: number; hi: number; dist: number[] }
export interface SeedPath { keys: string[]; wins: boolean[]; p: number; all: SeedLine; champ: SeedLine | null; noChamp: SeedLine | null; pChamp: number }
function line(seedsOf: number[], size: number, byes: number): SeedLine {
  const n = seedsOf.length, dist = new Array(size + 1).fill(0); for (const s of seedsOf) dist[s]++;
  const inF = seedsOf.filter((s) => s > 0).sort((a, b) => a - b); let mode = 0, best = 0; for (let s = 1; s <= size; s++) if (dist[s] > best) { best = dist[s]; mode = s; }
  return { n, make: n ? inF.length / n : 0, bye: n ? inF.filter((s) => s <= byes).length / n : 0, mode, lo: inF.length ? inF[Math.floor(inF.length * 0.1)] : 0, hi: inF.length ? inF[Math.min(inF.length - 1, Math.floor(inF.length * 0.9))] : 0, dist: dist.map((x) => (n ? x / n : 0)) };
}
function paths(p: Pack, locks: Locks, team: number, chaos: number): { games: string[]; rows: SeedPath[] } {
  const mine = p.games.filter((g) => (g.h === team || g.a === team) && !(g.key in locks)).slice(0, 3);
  const T = p.teams.length, C = p.confs.length, c = p.teams[team].conf, size = p.format.size; const rows: SeedPath[] = [];
  for (let m = (1 << mine.length) - 1; m >= 0; m--) {
    const cur: Locks = { ...locks }; const wins: boolean[] = []; let pr = 1;
    mine.forEach((g, i) => { const w = !!(m & (1 << (mine.length - 1 - i))); wins.push(w); const opp = g.h === team ? g.a : g.h; if (w) cur[g.key] = team; else if (opp >= 0) cur[g.key] = opp; const pw = g.h === team ? g.p : 1 - g.p; pr *= w ? pw : 1 - pw; });
    const r = simulate(p, { runs: 2500, locks: cur, chaos, keep: true }); const N = r.runs; const all: number[] = [], ch: number[] = [], no: number[] = [];
    for (let s = 0; s < N; s++) { const sd = r.seedRun![s * T + team]; all.push(sd); if (c >= 0 && p.confs[c].title) (r.champRun![s * C + c] === team ? ch : no).push(sd); }
    rows.push({ keys: mine.map((g) => g.key), wins, p: pr, all: line(all, size, p.format.byes), champ: ch.length >= 60 ? line(ch, size, p.format.byes) : null, noChamp: ch.length >= 60 && no.length >= 60 ? line(no, size, p.format.byes) : null, pChamp: N ? ch.length / N : 0 });
  }
  return { games: mine.map((g) => g.key), rows };
}

self.onmessage = (e: MessageEvent) => {
  const { id, type, body } = e.data; let out: any = null; const transfer: Transferable[] = [];
  if (type === 'pack') { pack = { ...body.pack, committee: body.anchored ? COMMITTEE : { ...COMMITTEE, carry: () => 0, noise: () => 1.7 } } as Pack; out = true; }
  else if (!pack) out = null;
  else if (type === 'sim') { const r: Result = simulate(pack, { runs: body.runs ?? RUNS, locks: body.locks, chaos: body.chaos, keep: true }); const { outcomes, made, seedRun, champRun, ...rest } = r; out = { result: rest, chalk: chalk(pack, body.locks) }; }
  else if (type === 'team') {
    const mine = pack.games.filter((g) => (g.h === body.team || g.a === body.team) && !(g.key in body.locks));
    const pWin = mine.reduce((a, g) => a * (g.h === body.team ? g.p : 1 - g.p), 1);
    const w = simulate(pack, { runs: 3000, locks: body.locks, chaos: body.chaos, force: { team: body.team, mode: 'winout' } });
    const l = mine.length ? simulate(pack, { runs: 3000, locks: body.locks, chaos: body.chaos, force: { team: body.team, mode: 'loseone' } }) : null;
    out = { left: mine.length, pWin, winout: { make: w.make[body.team], bye: w.bye[body.team] }, loseone: l ? { make: l.make[body.team], bye: l.bye[body.team] } : null };
  }
  else if (type === 'draw') out = draw(pack, body.locks, body.team, body.chaos ?? 1);
  else if (type === 'paths') out = paths(pack, body.locks, body.team, body.chaos ?? 1);
  else if (type === 'season') {   // one random season, as picks for every game and title game
    const r = simulate(pack, { runs: 1, locks: body.locks, seed: body.seed, keep: true, noise: false });
    const picks: Locks = {}; pack.games.forEach((g, i) => { if (!(g.key in body.locks)) picks[g.key] = r.outcomes![i] ? g.h : g.a; });
    pack.confs.forEach((cf, c) => { const ch = pack!.teams.findIndex((t, i) => t.conf === c && r.confChamp[i] > 0.5); if (ch >= 0 && !(`t:${c}` in body.locks)) picks[`t:${c}`] = ch; });
    out = { picks };
  }
  (self as any).postMessage({ id, out }, transfer);
};
