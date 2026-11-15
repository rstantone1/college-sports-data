// The rules of the playoff and what we've learned about the committee. Changing the format for a new season
// (a bigger field, different automatic bids) is an edit here, not a rewrite.

export interface Format {
  season: number;
  size: number;              // teams in the field
  byes: number;              // top seeds that sit out the first round
  autoPower: boolean;        // every power-conference champion gets in
  autoOther: number;         // plus this many of the best other champions (or, without autoPower, the N best champions overall)
  power: string[];           // conferences the rules treat as power conferences
  selection: string;         // the day the field is set
  rounds: string[];          // what reaching each bracket round is called, first games after the byes onward
}

export const FORMATS: Record<number, Format> = {
  // 2026: twelve teams. The four power-conference champions and the best champion from the other six leagues are
  // in automatically; the rest are the committee's highest-ranked teams. Seeds follow the ranking, top four get byes.
  2026: { season: 2026, size: 12, byes: 4, autoPower: true, autoOther: 1, power: ['SEC', 'Big Ten', 'Big 12', 'ACC'], selection: '2026-12-06T17:00:00Z',
    rounds: ['Quarterfinal', 'Semifinal', 'Title game', 'National champion'] },
};
export const formatFor = (season: number): Format => FORMATS[season] ?? { ...FORMATS[2026], season };

// The committee, learned from every weekly ranking it has published since 2014 (trained on 2014-19, checked on
// 2023-25: it matched 11.3 of the committee's final top 12 on average, one spot off for a typical team).
//   score = 1.92 x wins above bubble + 1.38 x (power rating / 10) - 0.91 x losses + 1.15 for a power-conference team
//           (whose losses cost 0.30 less each) + a sliver for a conference title
// The committee is also consistent with itself: about 60% of the gap between its current ranking and this score is
// still there in its final ranking (88% with one release to go), so each simulated season starts from where the
// committee has teams today.
export interface Committee { beta: number[]; carry: (releasesLeft: number) => number; noise: (releasesLeft: number) => number }
export const COMMITTEE: Committee = {
  beta: [1.916, 1.38, -0.906, 1.147, 0.026, 0.3],
  carry: (n) => (n <= 0 ? 1 : n === 1 ? 0.88 : n <= 3 ? 0.62 : 0.56),
  // Checked by replaying past seasons from 1-4 rankings out: with this much noise, teams we gave 50% a top-12
  // finish got one about half the time, and 99% teams about 96%.
  noise: (n) => (n <= 0 ? 0.3 : n === 1 ? 0.8 : 1.5),
};
export const resume = (b: number[], t: { wab: number; pr: number; l: number; power: boolean }) => b[0] * t.wab + b[1] * (t.pr / 10) + b[2] * t.l + (t.power ? b[3] + b[5] * t.l : 0);
