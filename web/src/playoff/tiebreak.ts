// Who plays for a conference title when records are level. Each league publishes an ordered list of tiebreakers;
// this walks that list the way the league does, including the restart after every team that is separated.
//
// Sources: each conference's published football tiebreaker policy (Big Ten, SEC and Big 12: the 2024 policies,
// carried forward; ACC: the policy amended July 2026, which goes from head-to-head straight to a team rating).
// The leagues' last resorts are a third-party team rating and then a draw. Neither can be worked out from wins and
// losses, so 'rating' here is a stand-in (the team's season so far) and is reported as such wherever it decides.
export type Step = 'h2h' | 'common' | 'placed' | 'oppPct' | 'wins' | 'rating';
export const STEP_LABEL: Record<Step, string> = { h2h: 'head-to-head', common: 'record against common opponents', placed: 'record against the best common opponent', oppPct: "opponents' conference record", wins: 'total wins', rating: 'team rating' };
const STANDARD: Step[] = ['h2h', 'common', 'placed', 'oppPct', 'rating'];
const BY_CONF: Record<string, Step[]> = { 'Big Ten': STANDARD, SEC: STANDARD, 'Big 12': ['h2h', 'common', 'placed', 'oppPct', 'wins', 'rating'], ACC: ['h2h', 'rating'] };
export const stepsFor = (conf: string): Step[] => BY_CONF[conf] ?? STANDARD;
export const officialSteps = (conf: string) => conf in BY_CONF;

// One conference's season, in local team numbers 0..n-1.
export interface Table { n: number; beat: Uint8Array; played: Uint8Array; cw: Float32Array; cl: Float32Array; wins: Float32Array; rating: Float32Array }
const EPS = 1e-9;
const pct = (w: number, l: number) => (w + l > 0 ? w / (w + l) : 0);

// Keep the teams with the best value. Returns the same array when nobody is separated.
function best(S: number[], v: number[]): number[] { let m = -Infinity; for (const x of v) if (x > m) m = x; const out = S.filter((_, i) => v[i] > m - EPS); return out.length === S.length ? S : out; }

// The one team that comes out on top of a tie, and the first step that separated anyone.
export function breakTie(t: Table, S: number[], steps: Step[], first: Step | null = null): [number, Step] {
  if (S.length === 1) return [S[0], first ?? 'h2h'];
  const n = t.n;
  for (const step of steps) {
    let B: number[] = S;
    if (step === 'h2h') {
      if (S.length === 2) { const [a, b] = S; if (t.played[a * n + b]) return [t.beat[a * n + b] ? a : b, first ?? step]; continue; }
      let complete = true; for (const a of S) for (const b of S) if (a !== b && !t.played[a * n + b]) complete = false;
      if (complete) B = best(S, S.map((a) => { let w = 0; for (const b of S) if (b !== a && t.beat[a * n + b]) w++; return w; }));
      else {
        const swept = S.find((a) => S.every((b) => b === a || t.beat[a * n + b])); if (swept != null) return [swept, first ?? step];
        const lostAll = S.find((a) => S.every((b) => b === a || t.beat[b * n + a])); if (lostAll != null) B = S.filter((x) => x !== lostAll);
      }
    } else if (step === 'common' || step === 'placed') {
      const common: number[] = []; for (let o = 0; o < n; o++) if (!S.includes(o) && S.every((a) => t.played[a * n + o])) common.push(o);
      if (!common.length) continue;
      if (step === 'common') B = best(S, S.map((a) => { let w = 0; for (const o of common) if (t.beat[a * n + o]) w++; return w / common.length; }));
      else {   // down the standings, a level of tied opponents taken together
        common.sort((x, y) => pct(t.cw[y], t.cl[y]) - pct(t.cw[x], t.cl[x]));
        for (let i = 0; i < common.length && B === S;) { let j = i; const p = pct(t.cw[common[i]], t.cl[common[i]]); while (j < common.length && Math.abs(pct(t.cw[common[j]], t.cl[common[j]]) - p) < EPS) j++;
          B = best(S, S.map((a) => { let w = 0; for (let k = i; k < j; k++) if (t.beat[a * n + common[k]]) w++; return w / (j - i); })); i = j; }
      }
    } else if (step === 'oppPct') B = best(S, S.map((a) => { let w = 0, g = 0; for (let o = 0; o < n; o++) if (o !== a && t.played[a * n + o]) { w += t.cw[o]; g += t.cw[o] + t.cl[o]; } return g ? w / g : 0; }));
    else if (step === 'wins') B = best(S, S.map((a) => t.wins[a]));
    else { let top = S[0]; for (const a of S) if (t.rating[a] > t.rating[top]) top = a; return [top, first ?? step]; }
    if (B !== S) return breakTie(t, B, steps, first ?? step);   // a smaller tie starts again from the top of the list
  }
  let top = S[0]; for (const a of S) if (t.rating[a] > t.rating[top]) top = a; return [top, first ?? 'rating'];
}

// The two teams in the title game. how: null = on record alone, otherwise the step that put the team there.
export function topTwo(t: Table, steps: Step[]): { a: number; b: number; howA: Step | null; howB: Step | null } {
  const ids = Array.from({ length: t.n }, (_, i) => i).sort((x, y) => pct(t.cw[y], t.cl[y]) - pct(t.cw[x], t.cl[x]));
  const level = (from: number) => { const p = pct(t.cw[ids[from]], t.cl[ids[from]]); let j = from; while (j < ids.length && Math.abs(pct(t.cw[ids[j]], t.cl[ids[j]]) - p) < EPS) j++; return ids.slice(from, j); };
  const g1 = level(0);
  if (g1.length === 1) { const g2 = level(1); if (g2.length === 1) return { a: g1[0], b: g2[0], howA: null, howB: null }; const [b, how] = breakTie(t, g2, steps); return { a: g1[0], b, howA: null, howB: how }; }
  if (g1.length === 2) return { a: g1[0], b: g1[1], howA: null, howB: null };
  const [a, howA] = breakTie(t, g1, steps); const [b, howB] = breakTie(t, g1.filter((x) => x !== a), steps);
  return { a, b, howA, howB };
}
