// The playoff simulator. Plays the rest of the season thousands of times: every remaining game, each conference's
// title game, the committee's final ranking, the field under this year's rules, and the bracket through the title.
// Pure functions on plain arrays so it runs the same in a web worker or a test script.
//
// Every run reuses the same random draws for the same game, so changing one pick changes the answer because of the
// pick and not because the dice were re-rolled. That keeps "what this result does to everyone else" stable.
import type { Format, Committee } from './config';

export interface PTeam {
  id: number; name: string; abbr: string; logo: string | null; color: string | null;
  conf: number;            // index into Pack.confs, -1 for independents
  power: boolean;          // power-conference team (or Notre Dame) in the committee's eyes
  nd: boolean;
  w: number; l: number; cw: number; cl: number;
  wab: number;             // wins above what a bubble team would have against the same schedule
  pr: number;              // points better than an average team on a neutral field
  bub: number;             // a bubble team's chance to beat this team on a neutral field
  cfp: number | null;      // the committee's latest ranking
  anchor: number;          // how far the committee has this team from where its resume alone would put it
  ourRank: number;
}
export interface PGame {
  key: string;             // game id, stable across runs
  id: number; date: number; week: number;
  h: number; a: number;    // team indexes; -1 = an opponent outside FBS
  neutral: boolean; conf: boolean;
  p: number;               // home team's chance to win
  bubH: number; bubA: number;   // a bubble team's chance to win in the home / away team's place
  live?: { hs: number; as: number; detail: string };
}
export interface PConf { name: string; teams: number[]; power: boolean; title: boolean; set?: [number, number] }
export interface Pack {
  season: number; teams: PTeam[]; games: PGame[]; confs: PConf[];
  h2h: Record<string, number>;   // "lowIdx-highIdx" -> winner index, for conference games already played
  hca: number; sd: number;       // home edge in points, spread of results in points
  releasesLeft: number;          // committee rankings still to come, including the final one
  format: Format; committee: Committee;
}

export type Locks = Record<string, number>;   // game key -> winning team index; "t:<conf index>" -> champion index
export interface Opts { runs: number; locks: Locks; chaos?: number; seed?: number; force?: { team: number; mode: 'winout' | 'loseone' }; keep?: boolean; noise?: boolean }

export interface Result {
  runs: number; rare: boolean;                 // rare: the picks describe something that almost never happens
  make: Float32Array; bye: Float32Array; host: Float32Array; auto: Float32Array; titleGame: Float32Array; confChamp: Float32Array;
  reach: Float32Array[];                       // reach[r][team]: got to round r of the bracket (0 = first games after byes ... last = won it all)
  seeds: Float32Array;                         // teams x field size
  expW: Float32Array;
  outcomes?: Uint8Array; made?: Uint8Array;    // per run: who won each game (1 = home), who made the field
  lev?: { teams: number[]; games: number[]; d: Float32Array; impact: Float32Array };
}

// Small fast seeded generator (mulberry32).
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function normCdf(z: number) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp((-z * z) / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
// Chaos: 1 = our real win chances; above 1 favorites win more often; toward 0 every game drifts to a coin flip.
const bend = (p: number, k: number) => (k === 1 ? p : 1 / (1 + Math.pow((1 - p) / Math.max(1e-9, p), k)));
const bracketOrder = (n: number): number[] => { let o = [1]; while (o.length < n) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); } return o; };

export function simulate(pack: Pack, o: Opts): Result {
  const { teams, games, confs, format: F, committee: C } = pack;
  const T = teams.length, G = games.length, N = o.runs, k = o.chaos ?? 1, size = F.size;
  const make = new Float32Array(T), bye = new Float32Array(T), host = new Float32Array(T), auto = new Float32Array(T), titleGame = new Float32Array(T), confChamp = new Float32Array(T), expW = new Float32Array(T);
  const rounds = Math.round(Math.log2(F.byes * 2)) + 1;      // 12 teams: quarterfinal, semifinal, final, champion
  const reach = Array.from({ length: rounds + 1 }, () => new Float32Array(T));
  const seeds = new Float32Array(T * size);
  const outcomes = o.keep ? new Uint8Array(N * G) : undefined, made = o.keep ? new Uint8Array(N * T) : undefined;
  const beta = C.beta, lam = C.carry(pack.releasesLeft), sig = o.noise === false ? 0 : C.noise(pack.releasesLeft);
  const lock = games.map((g) => (g.key in o.locks ? o.locks[g.key] : -1));
  const tLock = confs.map((_, i) => (`t:${i}` in o.locks ? o.locks[`t:${i}`] : -1));
  const pk = games.map((g) => bend(g.p, k));
  const neutralP = (a: number, b: number) => bend(normCdf((teams[a].pr - teams[b].pr) / pack.sd), k);
  const homeP = (a: number, b: number) => bend(normCdf((teams[a].pr - teams[b].pr + pack.hca) / pack.sd), k);
  const mine = o.force ? games.map((g, i) => (g.h === o.force!.team || g.a === o.force!.team ? i : -1)).filter((i) => i >= 0) : [];
  // Lose exactly one: which one, weighted by how likely that exact season is.
  const loseW = mine.map((i) => { const g = games[i]; const pw = g.h === o.force!.team ? pk[i] : 1 - pk[i]; return (1 - pw) / Math.max(1e-6, pw); });
  const loseTot = loseW.reduce((a, b) => a + b, 0);

  const w = new Float32Array(T), l = new Float32Array(T), cw = new Float32Array(T), cl = new Float32Array(T), wab = new Float32Array(T), score = new Float32Array(T);
  const res = new Uint8Array(G), champ = new Int16Array(confs.length), pair = new Int16Array(confs.length * 2), order = new Int16Array(T), isAuto = new Uint8Array(T), field = new Int16Array(size);
  const bOrder = bracketOrder(F.byes * 2);
  let done = 0, tries = 0; const maxTries = N * 12;
  while (done < N && tries < maxTries) {
    const r = rng((o.seed ?? 20261) + tries * 7919); tries++;
    for (let i = 0; i < T; i++) { const t = teams[i]; w[i] = t.w; l[i] = t.l; cw[i] = t.cw; cl[i] = t.cl; wab[i] = t.wab; }
    let loser = -1;
    if (o.force?.mode === 'loseone' && mine.length) { let x = r() * loseTot; loser = mine[mine.length - 1]; for (let j = 0; j < mine.length; j++) { x -= loseW[j]; if (x <= 0) { loser = mine[j]; break; } } } else if (o.force) r();
    // Regular season.
    for (let i = 0; i < G; i++) {
      const g = games[i], u = r();
      let hw = lock[i] >= 0 ? lock[i] === g.h : u < pk[i];
      if (o.force && (g.h === o.force.team || g.a === o.force.team) && lock[i] < 0) { const win = o.force.mode === 'winout' || i !== loser; hw = (g.h === o.force.team) === win; }
      res[i] = hw ? 1 : 0;
      if (g.h >= 0) { if (hw) w[g.h]++; else l[g.h]++; wab[g.h] += (hw ? 1 : 0) - g.bubH; if (g.conf) { if (hw) cw[g.h]++; else cl[g.h]++; } }
      if (g.a >= 0) { if (hw) l[g.a]++; else w[g.a]++; wab[g.a] += (hw ? 0 : 1) - g.bubA; if (g.conf) { if (hw) cl[g.a]++; else cw[g.a]++; } }
    }
    // Conference title games: the two best conference records. Ties go to head-to-head when it's two teams that
    // played, otherwise to the better overall resume (a stand-in for each league's long tiebreaker list).
    let ok = true;
    for (let c = 0; c < confs.length; c++) {
      const cf = confs[c], u = r(); champ[c] = -1;
      if (!cf.title || cf.teams.length < 2) continue;
      let a = -1, b = -1;
      if (cf.set) { a = cf.set[0]; b = cf.set[1]; }
      else {
        const val = (i: number) => (cw[i] + cl[i] ? cw[i] / (cw[i] + cl[i]) : 0) * 1000 + wab[i] * 0.01;
        for (const i of cf.teams) { if (a < 0 || val(i) > val(a)) { b = a; a = i; } else if (b < 0 || val(i) > val(b)) b = i; }
        // Head-to-head for the last spot, when exactly one other team is level with the runner-up.
        let tied = -1, nt = 0; const pb = cw[b] / Math.max(1, cw[b] + cl[b]);
        for (const i of cf.teams) if (i !== a && i !== b && Math.abs(cw[i] / Math.max(1, cw[i] + cl[i]) - pb) < 1e-9) { tied = i; nt++; }
        if (nt === 1) { const key = b < tied ? `${b}-${tied}` : `${tied}-${b}`; let win = pack.h2h[key]; if (win == null) { const gi = pack_gameBetween(pack, b, tied); if (gi >= 0) win = res[gi] ? games[gi].h : games[gi].a; } if (win === tied) b = tied; }
      }
      const forced = tLock[c] >= 0 ? tLock[c] : o.force?.mode === 'winout' && (a === o.force.team || b === o.force.team) ? o.force.team : -1;
      if (tLock[c] >= 0 && a !== tLock[c] && b !== tLock[c]) { ok = false; break; }
      const aw = forced >= 0 ? forced === a : u < neutralP(a, b);
      const win = aw ? a : b, lose = aw ? b : a;
      w[win]++; l[lose]++; wab[win] += 1 - teams[lose].bub; wab[lose] -= teams[win].bub; champ[c] = win;
      pair[2 * c] = a; pair[2 * c + 1] = b;
    }
    if (!ok) continue;   // a picked champion didn't reach its title game in this run: not part of the scenario
    for (let c = 0; c < confs.length; c++) if (champ[c] >= 0) { titleGame[pair[2 * c]]++; titleGame[pair[2 * c + 1]]++; }
    // The committee: resume score, pulled toward where they already have the team, plus the noise they've shown.
    for (let i = 0; i < T; i++) {
      const t = teams[i]; const u1 = r(), u2 = r();
      const z = sig ? Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(6.283185307 * u2) : 0;
      score[i] = beta[0] * wab[i] + beta[1] * (t.pr / 10) + beta[2] * l[i] + (t.power ? beta[3] + beta[5] * l[i] : 0) + lam * t.anchor + sig * z;
      order[i] = i;
    }
    for (let c = 0; c < confs.length; c++) if (champ[c] >= 0) score[champ[c]] += beta[4];
    order.sort((x, y) => score[y] - score[x]);
    // The field. Automatic bids first (they're in wherever they're ranked), then the best of the rest.
    isAuto.fill(0);
    let bestOther = -1;
    for (let c = 0; c < confs.length; c++) { const ch = champ[c]; if (ch < 0) continue; if (confs[c].power && F.autoPower) isAuto[ch] = 1; else if (!confs[c].power && (bestOther < 0 || score[ch] > score[bestOther])) bestOther = ch; }
    if (!F.autoPower) { // older rule: the N highest-ranked champions, any conference
      const chs = Array.from(champ).filter((x) => x >= 0).sort((x, y) => score[y] - score[x]).slice(0, F.autoOther); for (const ch of chs) isAuto[ch] = 1;
    } else if (bestOther >= 0 && F.autoOther > 0) isAuto[bestOther] = 1;
    let nAuto = 0; for (let i = 0; i < T; i++) nAuto += isAuto[i];
    let n = 0, atLarge = size - nAuto;
    for (let j = 0; j < T && n < size; j++) { const i = order[j]; if (isAuto[i]) field[n++] = i; else if (atLarge > 0) { field[n++] = i; atLarge--; } }
    // Bracket. Seeds follow the ranking; the top seeds sit out the first round, which is played at the better seed's home.
    const alive = new Int16Array(F.byes * 2);    // slot -> team, in bracket order by bye seed
    for (let s = 0; s < size; s++) { const i = field[s]; make[i]++; seeds[i * size + s]++; if (isAuto[i]) auto[i]++; if (s < F.byes) bye[i]++; else if (s < F.byes * 2) host[i]++; if (made) made[done * T + i] = 1; }
    for (let j = 0; j < F.byes; j++) {            // first round: seed byes+1+j hosts seed size-j, winner meets bye seed byes-j
      const hi = field[F.byes + j], lo = field[size - 1 - j], u = r();
      const win = u < homeP(hi, lo) ? hi : lo, byeSeed = F.byes - j;
      const slot = bOrder.indexOf(byeSeed);       // bye seed's slot; its opponent sits in the paired slot
      alive[slot] = field[byeSeed - 1]; alive[slot ^ 1] = win;
    }
    let cur: Int16Array = alive, rd = 0;
    for (let i = 0; i < cur.length; i++) reach[0][cur[i]]++;
    while (cur.length > 1) { const nx = new Int16Array(cur.length / 2); for (let i = 0; i < nx.length; i++) { const a = cur[2 * i], b = cur[2 * i + 1]; nx[i] = r() < neutralP(a, b) ? a : b; } rd++; for (let i = 0; i < nx.length; i++) reach[rd][nx[i]]++; cur = nx; }
    for (let c = 0; c < confs.length; c++) if (champ[c] >= 0) confChamp[champ[c]]++;
    for (let i = 0; i < T; i++) expW[i] += w[i];
    if (outcomes) outcomes.set(res, done * G);
    done++;
  }
  const div = (a: Float32Array) => { for (let i = 0; i < a.length; i++) a[i] /= Math.max(1, done); };
  [make, bye, host, auto, titleGame, confChamp, expW, seeds, ...reach].forEach(div);
  const out: Result = { runs: done, rare: done < Math.min(N, 300), make, bye, host, auto, titleGame, confChamp, reach, seeds, expW, outcomes: outcomes?.subarray(0, done * G), made: made?.subarray(0, done * T) };
  if (o.keep && done > 200) out.lev = leverage(pack, out, lock);
  return out;
}

function pack_gameBetween(pack: Pack, a: number, b: number) { const g = pack.games; for (let i = 0; i < g.length; i++) if (g[i].conf && ((g[i].h === a && g[i].a === b) || (g[i].h === b && g[i].a === a))) return i; return -1; }
// What each undecided game does to each contender: chance to make the field if the home team wins, minus if it loses.
function leverage(pack: Pack, r: Result, lock: number[]) {
  const T = pack.teams.length, G = pack.games.length, N = r.runs, out = r.outcomes!, made = r.made!;
  const teams = Array.from({ length: T }, (_, i) => i).filter((i) => r.make[i] > 0.004 && r.make[i] < 0.996).sort((a, b) => Math.abs(r.make[a] - 0.5) - Math.abs(r.make[b] - 0.5)).slice(0, 36);
  const games = Array.from({ length: G }, (_, i) => i).filter((i) => lock[i] < 0);
  const d = new Float32Array(games.length * teams.length), impact = new Float32Array(games.length);
  const nH = new Float64Array(games.length), mH = new Float64Array(games.length * teams.length), mA = new Float64Array(games.length * teams.length);
  for (let s = 0; s < N; s++) {
    const ob = s * G, mb = s * T;
    for (let gi = 0; gi < games.length; gi++) { const hw = out[ob + games[gi]]; if (hw) nH[gi]++; const row = gi * teams.length; for (let ti = 0; ti < teams.length; ti++) if (made[mb + teams[ti]]) { if (hw) mH[row + ti]++; else mA[row + ti]++; } }
  }
  for (let gi = 0; gi < games.length; gi++) { const h = nH[gi], a = N - h; const row = gi * teams.length; for (let ti = 0; ti < teams.length; ti++) { const v = h >= 40 && a >= 40 ? mH[row + ti] / h - mA[row + ti] / a : 0; d[row + ti] = v; impact[gi] += Math.abs(v); } }
  return { teams, games, d, impact };
}

// The single most likely version of the picks: every undecided game goes to the favorite, no committee noise.
export interface Chalk { seeds: number[]; auto: boolean[]; champs: number[] }
export function chalk(pack: Pack, locks: Locks): Chalk {
  const full: Locks = { ...locks };
  for (const g of pack.games) if (!(g.key in full)) full[g.key] = g.p >= 0.5 ? g.h : g.a;
  const r = simulate(pack, { runs: 1, locks: full, chaos: 60, noise: false, seed: 1 });
  const size = pack.format.size, seeds: number[] = new Array(size).fill(-1), auto: boolean[] = new Array(size).fill(false);
  for (let i = 0; i < pack.teams.length; i++) for (let s = 0; s < size; s++) if (r.seeds[i * size + s] > 0.5) { seeds[s] = i; auto[s] = r.auto[i] > 0.5; }
  return { seeds, auto, champs: pack.confs.map((_, c) => pack.teams.findIndex((_, i) => r.confChamp[i] > 0.5 && pack.teams[i].conf === c)) };
}
