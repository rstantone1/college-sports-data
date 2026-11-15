// The NCAA tournament simulator for basketball. Plays the rest of the regular season and every conference
// tournament, picks the field the way the committee does (conference champions plus the best remaining resumes),
// seeds it, and plays the bracket. Same idea as the football playoff simulator, sized for 360 teams.
//
// What decides an at-large bid: wins above bubble (how many more games a team has won than a bubble team would
// have against the same schedule). Checked against every field since 2014: on 2023-26, seasons it never saw, 98%
// of the men's teams it ranked inside the at-large range made the field, and 100% of the women's.
export interface BTeam { id: number; name: string; abbr: string; logo: string | null; conf: number; w: number; l: number; cw: number; cl: number; wab: number; pr: number; bub: number; ourRank: number }
export interface BGame { key: string; date: number; h: number; a: number; neutral: boolean; conf: boolean; p: number; m: number; bubH: number; bubA: number; soon: boolean }
export interface BConf { name: string; teams: number[] }
export interface BFormat { size: number; autos: number; opening: number; powerWeight: number; noise: number; rounds: string[] }
export interface BPack { sport: string; season: number; teams: BTeam[]; games: BGame[]; confs: BConf[]; sd: number; ratingSd: number; format: BFormat }
export type BLocks = Record<string, number>;
export interface BResult {
  runs: number; make: Float32Array; auto: Float32Array; lines: Float32Array;   // lines: teams x 18 (0 out, 1-16 seed line, 17 lost in the opening round)
  reach: Float32Array[]; expW: Float32Array; expL: Float32Array;
  seedRun?: Uint8Array; watch?: number[]; outcomes?: Uint8Array;
  lev?: { teams: number[]; games: number[]; d: Float32Array; impact: Float32Array };
}
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function normCdf(z: number) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp((-z * z) / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
const REGION = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

export function simulate(pack: BPack, o: { runs: number; locks: BLocks; seed?: number; keep?: boolean; focus?: number[] }): BResult {
  const { teams, games, confs, format: F } = pack; const T = teams.length, G = games.length, N = o.runs;
  const make = new Float32Array(T), auto = new Float32Array(T), lines = new Float32Array(T * 18), expW = new Float32Array(T), expL = new Float32Array(T);
  const reach = Array.from({ length: 7 }, () => new Float32Array(T));
  const watch = o.keep ? games.map((g, i) => (g.soon && !(g.key in o.locks) ? i : -1)).filter((i) => i >= 0) : [];
  const outcomes = o.keep ? new Uint8Array(N * watch.length) : undefined, seedRun = o.keep ? new Uint8Array(N * T) : undefined;
  const gh = Int16Array.from(games.map((g) => g.h)), ga = Int16Array.from(games.map((g) => g.a)), gp = Float32Array.from(games.map((g) => g.p)), gbh = Float32Array.from(games.map((g) => g.bubH)), gba = Float32Array.from(games.map((g) => g.bubA));
  const gc = Uint8Array.from(games.map((g) => (g.conf ? 1 : 0))), lock = Int16Array.from(games.map((g) => (g.key in o.locks ? o.locks[g.key] : -1)));
  const gm = Float32Array.from(games.map((g) => g.m)), pr0 = Float32Array.from(teams.map((t) => t.pr)), pr = new Float32Array(T), dl = new Float32Array(T), bub = Float32Array.from(teams.map((t) => t.bub));
  const w = new Float32Array(T), l = new Float32Array(T), cw = new Float32Array(T), cl = new Float32Array(T), wab = new Float32Array(T), score = new Float32Array(T), isAuto = new Uint8Array(T), res = new Uint8Array(G);
  const neutral = (a: number, b: number) => normCdf((pr[a] - pr[b]) / pack.sd);
  const play = (a: number, b: number, u: number) => { const aw = u < neutral(a, b); const win = aw ? a : b, lose = aw ? b : a; w[win]++; l[lose]++; wab[win] += 1 - bub[lose]; wab[lose] -= bub[win]; return win; };
  const order = new Int16Array(T), field = new Int16Array(F.size), main = new Int16Array(64);
  for (let n = 0; n < N; n++) {
    const r = rng((o.seed ?? 77) + n * 7919);
    // We don't know exactly how good each team is, least of all early in the season: each run nudges every team's
    // rating by a different amount, so a November favorite isn't treated as a sure thing in March.
    for (let i = 0; i < T; i++) { const t = teams[i]; w[i] = t.w; l[i] = t.l; cw[i] = t.cw; cl[i] = t.cl; wab[i] = t.wab; const u1 = r(), u2 = r(); dl[i] = pack.ratingSd * Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(6.283185307 * u2); pr[i] = pr0[i] + dl[i]; }
    for (let i = 0; i < G; i++) { const u = r(), h = gh[i], a = ga[i]; const p = h >= 0 && a >= 0 ? normCdf((gm[i] + dl[h] - dl[a]) / pack.sd) : gp[i]; const hw = lock[i] >= 0 ? lock[i] === h : u < p; res[i] = hw ? 1 : 0;
      if (h >= 0) { if (hw) w[h]++; else l[h]++; wab[h] += (hw ? 1 : 0) - gbh[i]; if (gc[i]) { if (hw) cw[h]++; else cl[h]++; } }
      if (a >= 0) { if (hw) l[a]++; else w[a]++; wab[a] += (hw ? 0 : 1) - gba[i]; if (gc[i]) { if (hw) cl[a]++; else cw[a]++; } } }
    // Conference tournaments: seeded by conference record, single elimination on a neutral floor, byes for the top seeds.
    isAuto.fill(0);
    for (let c = 0; c < confs.length; c++) { const ts = confs[c].teams; if (ts.length < 2) { if (ts.length === 1) isAuto[ts[0]] = 1; continue; }
      const seeded = [...ts].sort((x, y) => (cw[y] / Math.max(1, cw[y] + cl[y]) - cw[x] / Math.max(1, cw[x] + cl[x])) || wab[y] - wab[x]).slice(0, 16);
      let size = 1; while (size < seeded.length) size *= 2;
      let cur: number[] = bracketOrder(size).map((s) => (s <= seeded.length ? seeded[s - 1] : -1));
      while (cur.length > 1) { const nx: number[] = []; for (let i = 0; i < cur.length; i += 2) { const a = cur[i], b = cur[i + 1]; nx.push(a < 0 ? b : b < 0 ? a : play(a, b, r())); } cur = nx; }
      isAuto[cur[0]] = 1; }
    for (let i = 0; i < T; i++) { const u1 = r(), u2 = r(); score[i] = wab[i] + F.powerWeight * (pr[i] / 10) + F.noise * Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(6.283185307 * u2); order[i] = i; }
    order.sort((x, y) => score[y] - score[x]);
    let nAuto = 0; for (let i = 0; i < T; i++) nAuto += isAuto[i];
    let k = 0, atl = F.size - nAuto; const atLarge: number[] = [], autos: number[] = [];
    for (let j = 0; j < T && k < F.size; j++) { const i = order[j]; if (isAuto[i]) { field[k++] = i; autos.push(i); } else if (atl > 0) { field[k++] = i; atLarge.push(i); atl--; } }
    // Opening round: the last at-large teams play each other, and so do the lowest-ranked champions.
    const half = F.opening / 2, out = new Set<number>();
    for (const grp of [atLarge.slice(-half), autos.slice(-half)]) for (let j = 0; j < grp.length; j += 2) { const a = grp[j], b = grp[j + 1]; if (b == null) break; const win = r() < neutral(a, b) ? a : b; out.add(win === a ? b : a); }
    let m = 0; for (let j = 0; j < k; j++) { const i = field[j]; make[i]++; if (isAuto[i]) auto[i]++; if (out.has(i)) { lines[i * 18 + 17]++; if (seedRun) seedRun[n * T + i] = 17; } else if (m < 64) main[m++] = i; }
    for (let j = 0; j < m; j++) { const i = main[j], line = (j >> 2) + 1; lines[i * 18 + line]++; reach[0][i]++; if (seedRun) seedRun[n * T + i] = line; }
    // Bracket: four regions filled along the S-curve, then six rounds.
    if (m === 64) { let cur: number[] = []; for (let reg = 0; reg < 4; reg++) for (const s of REGION) { const row = s - 1; cur.push(main[row * 4 + (row % 2 ? 3 - reg : reg)]); }
      let rd = 0; while (cur.length > 1) { const nx: number[] = []; for (let i = 0; i < cur.length; i += 2) nx.push(r() < neutral(cur[i], cur[i + 1]) ? cur[i] : cur[i + 1]); rd++; for (const t of nx) reach[rd][t]++; cur = nx; } }
    for (let i = 0; i < T; i++) { expW[i] += w[i]; expL[i] += l[i]; }
    if (outcomes) for (let j = 0; j < watch.length; j++) outcomes[n * watch.length + j] = res[watch[j]];
  }
  const div = (a: Float32Array) => { for (let i = 0; i < a.length; i++) a[i] /= N; };
  [make, auto, lines, expW, expL, ...reach].forEach(div);
  const out: BResult = { runs: N, make, auto, lines, reach, expW, expL, seedRun, watch, outcomes };
  if (o.keep && watch.length && N >= 400) out.lev = leverage(pack, out, o.focus);
  return out;
}
function bracketOrder(n: number): number[] { let o = [1]; while (o.length < n) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); } return o; }

// What each of the next few days' games does to each bubble team's chance of getting in.
function leverage(pack: BPack, r: BResult, focus?: number[]) {
  const T = pack.teams.length, N = r.runs, W = r.watch!.length, out = r.outcomes!, sr = r.seedRun!;
  const teams = focus ?? Array.from({ length: T }, (_, i) => i).filter((i) => r.make[i] > 0.03 && r.make[i] < 0.97).sort((a, b) => Math.abs(r.make[a] - 0.5) - Math.abs(r.make[b] - 0.5)).slice(0, 40);
  const d = new Float32Array(W * teams.length), impact = new Float32Array(W), nH = new Float64Array(W), mH = new Float64Array(W * teams.length), mA = new Float64Array(W * teams.length);
  for (let s = 0; s < N; s++) { const mk = teams.map((t) => sr[s * T + t] > 0); for (let gi = 0; gi < W; gi++) { const hw = out[s * W + gi]; if (hw) nH[gi]++; const row = gi * teams.length; for (let ti = 0; ti < teams.length; ti++) if (mk[ti]) { if (hw) mH[row + ti]++; else mA[row + ti]++; } } }
  for (let gi = 0; gi < W; gi++) { const h = nH[gi], a = N - h; if (h < 100 || a < 100) continue; const row = gi * teams.length; for (let ti = 0; ti < teams.length; ti++) { const v = mH[row + ti] / h - mA[row + ti] / a, pool = (mH[row + ti] + mA[row + ti]) / N, se = Math.sqrt(pool * (1 - pool) * (1 / h + 1 / a)); if (Math.abs(v) > 2.8 * se && Math.abs(v) >= 0.02) { d[row + ti] = v; impact[gi] += Math.abs(v); } } }
  return { teams, games: r.watch!, d, impact };
}
