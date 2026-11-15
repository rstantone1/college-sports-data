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

self.onmessage = (e: MessageEvent) => {
  const { id, type, body } = e.data; let out: any = null; const transfer: Transferable[] = [];
  if (type === 'pack') { pack = { ...body.pack, committee: body.anchored ? COMMITTEE : { ...COMMITTEE, carry: () => 0, noise: () => 1.7 } } as Pack; out = true; }
  else if (!pack) out = null;
  else if (type === 'sim') { const r: Result = simulate(pack, { runs: body.runs ?? RUNS, locks: body.locks, chaos: body.chaos, keep: true }); const { outcomes, made, ...rest } = r; out = { result: rest, chalk: chalk(pack, body.locks) }; }
  else if (type === 'team') {
    const mine = pack.games.filter((g) => (g.h === body.team || g.a === body.team) && !(g.key in body.locks));
    const pWin = mine.reduce((a, g) => a * (g.h === body.team ? g.p : 1 - g.p), 1);
    const w = simulate(pack, { runs: 3000, locks: body.locks, chaos: body.chaos, force: { team: body.team, mode: 'winout' } });
    const l = mine.length ? simulate(pack, { runs: 3000, locks: body.locks, chaos: body.chaos, force: { team: body.team, mode: 'loseone' } }) : null;
    out = { left: mine.length, pWin, winout: { make: w.make[body.team], bye: w.bye[body.team] }, loseone: l ? { make: l.make[body.team], bye: l.bye[body.team] } : null };
  }
  else if (type === 'draw') out = draw(pack, body.locks, body.team, body.chaos ?? 1);
  else if (type === 'season') {   // one random season, as picks for every game and title game
    const r = simulate(pack, { runs: 1, locks: body.locks, seed: body.seed, keep: true, noise: false });
    const picks: Locks = {}; pack.games.forEach((g, i) => { if (!(g.key in body.locks)) picks[g.key] = r.outcomes![i] ? g.h : g.a; });
    pack.confs.forEach((cf, c) => { const ch = pack!.teams.findIndex((t, i) => t.conf === c && r.confChamp[i] > 0.5); if (ch >= 0 && !(`t:${c}` in body.locks)) picks[`t:${c}`] = ch; });
    out = { picks };
  }
  (self as any).postMessage({ id, out }, transfer);
};
