// Walk-forward backtest: step through a season, rebuild ratings using only games before each cutoff, predict the
// games in the window that follows, and score the predictions against what happened, against simple baselines,
// and against the market line where one was stored.
//
//   npx tsx src/backtest.ts --sport=mbb --season=2026 [--step=7] [--prior=6] [--regress=0.5] [--sd=11] [--hca=2.2] [--json=out.json]
import { q } from './db.js';
import { SPORTS, type SportConfig } from './sports.js';
import { computeRatings, type RatingRow } from './ratings/efficiency.js';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const s: SportConfig = SPORTS[args.sport ?? 'mbb'];
const season = Number(args.season);
const step = Number(args.step ?? 7);
const priorK = Number(args.prior ?? 6), regress = Number(args.regress ?? 0.5);
const SCALE: Record<string, number> = { possession: 100, drive: 10, inning: s.regulationLength, minute: 90 };
const scale = SCALE[s.scoringUnit];
const TYPICAL: Record<string, number> = { mbb: 68, wbb: 70, cfb: 11.5, bsb: 9, sb: 7 };
const HCA: Record<string, number> = { mbb: 2.2, wbb: 2.2, cfb: 0.65, bsb: 0.15, sb: 0.15 };
const SD: Record<string, number> = { mbb: 11, wbb: 11.5, cfb: 15.5, bsb: 4.3, sb: 3.8 };
const hca = Number(args.hca ?? HCA[s.id]), sd = Number(args.sd ?? SD[s.id]);

function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

interface G { id: number; h: number; a: number; hs: number; as: number; neutral: boolean; start: string; spread: number | null; hd1: number; ad1: number }
interface P { game: number; date: string; margin: number; pHome: number; actual: number; homeWon: boolean; spread: number | null; hRec: number; aRec: number; prevRank?: number }

async function main() {
  const games = await q<G>(
    `select g.id, g.home_team_id h, g.away_team_id a, g.home_score hs, g.away_score "as", g.neutral_site neutral, g.start_time start, g.spread,
            (select count(*) from team_seasons ts where ts.team_id=g.home_team_id and ts.season_year=g.season_year) hd1,
            (select count(*) from team_seasons ts where ts.team_id=g.away_team_id and ts.season_year=g.season_year) ad1
     from games g where g.sport_id=$1 and g.season_year=$2 and g.completed and g.home_score is not null and coalesce(g.season_type,2)<>1
     order by g.start_time`, [s.id, season]);
  const d1 = games.filter((g) => Number(g.hd1) > 0 && Number(g.ad1) > 0);
  const first = new Date(d1[0].start), last = new Date(d1[d1.length - 1].start);
  console.log(`${s.id} ${season}: ${d1.length} D-I games, ${first.toISOString().slice(0, 10)} to ${last.toISOString().slice(0, 10)}; prior ${priorK} games, regress ${regress}, hca ${hca}, sd ${sd}`);

  const preds: P[] = [];
  // Start once there's something to rate (10 days in), then every `step` days.
  for (let cut = new Date(first.getTime() + 10 * 864e5); cut < last; cut = new Date(cut.getTime() + step * 864e5)) {
    const until = cut, to = new Date(cut.getTime() + step * 864e5);
    const r = await computeRatings(s, season, { priorGames: priorK, regress, until });
    const byId = new Map<number, RatingRow>(r.ratings.map((x) => [x.team_id, x]));
    const L = r.leagueAvg, LT = r.ratings.reduce((a, x) => a + x.tempo, 0) / r.ratings.length;
    // Records so far (for the "better record" baseline).
    const rec = new Map<number, [number, number]>();
    for (const g of d1) { if (new Date(g.start) >= until) break; const hw = g.hs > g.as; const H = rec.get(g.h) ?? [0, 0], A = rec.get(g.a) ?? [0, 0]; H[hw ? 0 : 1]++; A[hw ? 1 : 0]++; rec.set(g.h, H); rec.set(g.a, A); }
    const wp = (t: number) => { const x = rec.get(t) ?? [0, 0]; return x[0] + x[1] ? x[0] / (x[0] + x[1]) : 0.5; };
    for (const g of d1) {
      const t = new Date(g.start); if (t < until || t >= to) continue;
      const H = byId.get(g.h), A = byId.get(g.a); if (!H || !A) continue;
      const site = g.neutral ? 0 : 1;
      const units = (H.tempo * A.tempo) / LT;
      const hEff = (H.adj_off * A.adj_def) / L + site * hca, aEff = (A.adj_off * H.adj_def) / L - site * hca;
      const margin = ((hEff - aEff) * units) / scale;
      preds.push({ game: g.id, date: new Date(g.start).toISOString().slice(0, 10), margin, pHome: normCdf(margin / sd), actual: g.hs - g.as, homeWon: g.hs > g.as, spread: g.spread == null ? null : Number(g.spread), hRec: wp(g.h), aRec: wp(g.a) });
    }
    process.stdout.write(`  ${until.toISOString().slice(0, 10)}: ${r.ratings.length} teams, ${preds.length} predictions so far\r`);
  }
  console.log();
  report(preds);
  if (args.json) await import('node:fs').then((fs) => fs.writeFileSync(args.json, JSON.stringify(preds)));
  process.exit(0);
}

function report(ps: P[]) {
  const n = ps.length;
  const acc = (f: (p: P) => boolean) => ps.filter(f).length / n;
  const modelRight = acc((p) => (p.pHome >= 0.5) === p.homeWon);
  const homeRight = acc((p) => p.homeWon);
  const recRight = ps.filter((p) => p.hRec !== p.aRec).length ? ps.filter((p) => p.hRec !== p.aRec && (p.hRec > p.aRec) === p.homeWon).length / ps.filter((p) => p.hRec !== p.aRec).length : NaN;
  const mae = ps.reduce((a, p) => a + Math.abs(p.margin - p.actual), 0) / n;
  const resid = ps.map((p) => p.actual - p.margin);
  const bias = resid.reduce((a, b) => a + b, 0) / n;
  const rmse = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / n);
  const brier = ps.reduce((a, p) => a + (p.pHome - (p.homeWon ? 1 : 0)) ** 2, 0) / n;
  const logloss = -ps.reduce((a, p) => a + Math.log(Math.max(1e-6, p.homeWon ? p.pHome : 1 - p.pHome)), 0) / n;
  console.log(`\n${n} predictions`);
  console.log(`Winner picked correctly:   model ${(modelRight * 100).toFixed(1)}%   | pick home team ${(homeRight * 100).toFixed(1)}%   | better record ${(recRight * 100).toFixed(1)}%`);
  console.log(`Margin error:              mean abs ${mae.toFixed(2)}, rmse ${rmse.toFixed(2)}, bias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)} (positive = home teams did better than predicted)`);
  console.log(`Probability quality:       Brier ${brier.toFixed(4)}, log loss ${logloss.toFixed(4)}  (coin flip: Brier 0.25, log loss 0.693)`);
  console.log(`Implied spread sd:         ${rmse.toFixed(1)} (the model assumes ${sd})`);

  // Calibration: when we say X%, how often does it happen?
  console.log('\nCalibration (favorite\'s chance → how often the favorite won)');
  const bins: Record<string, [number, number]> = {};
  for (const p of ps) {
    const fav = Math.max(p.pHome, 1 - p.pHome), won = (p.pHome >= 0.5) === p.homeWon;
    const b = fav >= 0.95 ? '95-100' : fav >= 0.9 ? '90-95' : fav >= 0.8 ? '80-90' : fav >= 0.7 ? '70-80' : fav >= 0.6 ? '60-70' : '50-60';
    bins[b] ??= [0, 0]; bins[b][0]++; if (won) bins[b][1]++;
  }
  for (const b of ['50-60', '60-70', '70-80', '80-90', '90-95', '95-100']) if (bins[b]) console.log(`  ${b.padEnd(7)} ${String(bins[b][0]).padStart(5)} games   favorite won ${((bins[b][1] / bins[b][0]) * 100).toFixed(1)}%`);

  // By month.
  console.log('\nBy month');
  const months = [...new Set(ps.map((p) => p.date.slice(0, 7)))].sort();
  for (const m of months) {
    const x = ps.filter((p) => p.date.startsWith(m));
    const a = x.filter((p) => (p.pHome >= 0.5) === p.homeWon).length / x.length;
    const e = x.reduce((s, p) => s + Math.abs(p.margin - p.actual), 0) / x.length;
    console.log(`  ${m}  ${String(x.length).padStart(5)} games   right ${(a * 100).toFixed(1)}%   margin error ${e.toFixed(2)}`);
  }

  // Against the market.
  const v = ps.filter((p) => p.spread != null);
  if (v.length) {
    const vn = v.length;
    const vegasMargin = (p: P) => -p.spread!;  // spread is home-team view: -3.5 means home favored by 3.5
    const vAcc = v.filter((p) => (vegasMargin(p) >= 0) === p.homeWon).length / vn;
    const mAcc = v.filter((p) => (p.pHome >= 0.5) === p.homeWon).length / vn;
    const vMae = v.reduce((a, p) => a + Math.abs(vegasMargin(p) - p.actual), 0) / vn;
    const mMae = v.reduce((a, p) => a + Math.abs(p.margin - p.actual), 0) / vn;
    const diff = v.reduce((a, p) => a + Math.abs(p.margin - vegasMargin(p)), 0) / vn;
    const ats = v.filter((p) => Math.abs(p.margin - vegasMargin(p)) >= 1);  // only where the model disagrees by a point or more
    const atsRight = ats.filter((p) => (p.margin > vegasMargin(p)) === (p.actual > vegasMargin(p))).length;
    const pushes = ats.filter((p) => p.actual === vegasMargin(p)).length;
    console.log(`\nAgainst the market (${vn} games with a line)`);
    console.log(`  Winner:        model ${(mAcc * 100).toFixed(1)}%   market ${(vAcc * 100).toFixed(1)}%`);
    console.log(`  Margin error:  model ${mMae.toFixed(2)}   market ${vMae.toFixed(2)}   (model vs market line differ by ${diff.toFixed(2)} on average)`);
    console.log(`  Against the spread where the model disagrees by 1+: ${atsRight}-${ats.length - atsRight - pushes}-${pushes} (${((atsRight / Math.max(1, ats.length - pushes)) * 100).toFixed(1)}%; break-even is 52.4%)`);
  } else console.log('\nNo market lines stored for these games yet (run ingest:odds).');
}

main().catch((e) => { console.error(e); process.exit(1); });
