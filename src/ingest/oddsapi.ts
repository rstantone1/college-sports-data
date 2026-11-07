// Lines from many sportsbooks at once (The Odds API), and the best-price finder built on them.
//
// The sharpest books (Pinnacle, Circa, BookMaker, BetOnline, LowVig) take big bets from winning players and move
// fast, so their price, with the bookmaker's cut taken out, is the best public estimate of each side's true chance.
// A softer book that's slow to move pays more than that true chance is worth: a bet with positive expected value
// that needs no model at all. This is the one edge that's well documented to last (it's what the pros measure
// themselves against), so it's priced properly here: every book's actual number and odds, against the fair price,
// with point differences converted to probability. When no sharp book has the game, the middle of all the books
// stands in, with a higher bar.
//
// Credits: one call per sport costs (markets x regions). The free plan is 500 a month, so each sport is pulled
// once a day around midday Central (football only Thursday to Saturday), and the run stops if the balance is low.
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';
import { bookName } from './lines.js';

const KEY = () => process.env.ODDS_API_KEY;
const API = 'https://api.the-odds-api.com/v4';
const SPORT_KEY: Record<string, string> = { mbb: 'basketball_ncaab', wbb: 'basketball_wncaab', cfb: 'americanfootball_ncaaf' };
// Pinnacle sits in the 'eu' region; the women's game rarely has it, so it pulls US books only (half the credits).
const REGIONS: Record<string, string> = { mbb: 'us,eu', wbb: 'us', cfb: 'us,eu' };
const SHARP = new Set(['pinnacle', 'circasports', 'circa', 'bookmaker', 'betonlineag', 'lowvig']);
// Books a US bettor can actually use. European books still help set the fair price but are never flagged.
const US_BOOKS = new Set(['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'espnbet', 'fanatics', 'hardrockbet', 'ballybet',
  'betparx', 'windcreek', 'bovada', 'mybookieag', 'betus', 'betanysports', 'fliff', 'superbook', 'unibet_us']);
// A book whose price is this much older than the sharp books' latest move is treated as stale, not as value.
const STALE_MS = 45 * 60e3;
// Spread of results around the market's number (points), used to turn a half point into a change in win chance.
const SD: Record<string, { spread: number; total: number }> = { mbb: { spread: 11, total: 16 }, wbb: { spread: 11, total: 15 }, cfb: { spread: 15, total: 17 } };
// Expected return needed to flag a price: against a sharp book's fair price, and against the books' median alone.
const MIN_EV_SHARP = 0.02, MIN_EV_MEDIAN = 0.035, MAX_EV = 0.12, STRONG_EV = 0.045;
const RESERVE = 40;   // credits kept back for manual runs

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(state)\b/g, 'st').replace(/\s+/g, ' ').trim();
function matchTeam(name: string, teams: { id: number; n: string; d: string }[]) {
  const x = norm(name);
  let best: { id: number; score: number } | null = null;
  for (const t of teams) {
    const n = norm(t.n), d = norm(t.d);
    let score = 0;
    if (x === d || x === n) score = 3;
    else if (x.startsWith(n + ' ') || x.startsWith(d + ' ')) score = 2 + n.length / 100;
    else if (d.startsWith(x) || n.startsWith(x)) score = 1;
    if (score && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

// Odds and probability helpers.
const dec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const amer = (p: number) => (p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
const devig = (a: number, b: number) => { const x = 1 / dec(a), y = 1 / dec(b); return x / (x + y); };
const Phi = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const PhiInv = (p: number) => { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const signed = (a: number) => (a > 0 ? `+${a}` : `${a}`);

interface Row { key: string; book: string; title: string; upd: number; sharp: boolean; spread: number | null; hsp: number | null; asp: number | null; total: number | null; op: number | null; up: number | null; hml: number | null; aml: number | null }
interface Cand { market: 'spread' | 'total' | 'moneyline'; side: string; line: number | null; price: number; book: string; fair: number; ev: number; fairLine: number; ref: 'sharp' | 'median'; refBooks: string[] }

// Credits left, from a free call. Null when the key is missing or the call fails.
export async function oddsCredits(): Promise<number | null> {
  const key = KEY(); if (!key) return null;
  const r = await fetch(`${API}/sports/?apiKey=${key}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r?.ok) return null;
  return Number(r.headers.get('x-requests-remaining') ?? NaN);
}

// Whether the scheduled job should pull this sport now. The daily job runs at :15 past every third UTC hour.
export function oddsDue(sportId: string, d = new Date()) {
  if (!SPORT_KEY[sportId]) return false;
  const h = d.getUTCHours(), dow = d.getUTCDay();
  if (sportId === 'cfb') return h === 15 && dow >= 4 && dow <= 6;   // Thu-Sat morning, before kickoffs
  return h === 18;                                                   // hoops: midday Central, before evening tips
}

export async function refreshOddsApi(s: SportConfig, season: number) {
  const key = KEY(); const sk = SPORT_KEY[s.id];
  if (!key || !sk) return;
  const left0 = await oddsCredits();
  if (left0 != null && left0 < RESERVE) { console.warn(`${s.id}: odds api skipped, only ${left0} credits left`); return; }
  const res = await fetch(`${API}/sports/${sk}/odds?regions=${REGIONS[s.id]}&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${key}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`odds api ${s.id}: ${res.status}`); return; }
  const left = res.headers.get('x-requests-remaining');
  const events: any[] = await res.json();
  const teams = (await q<any>(`select id, short_name n, display_name d from teams where sport_id=$1`, [s.id])).map((t) => ({ id: Number(t.id), n: t.n ?? '', d: t.d ?? '' }));
  const games = await q<any>(`select id, home_team_id h, away_team_id a, extract(epoch from start_time) t from games where sport_id=$1 and season_year=$2 and not completed and start_time between now() - interval '6 hours' and now() + interval '5 days'`, [s.id, season]);
  // Our model's pick for each game (if any), so a best price can say whether our numbers agree.
  const ours = new Map<string, string>();
  for (const b of await q<any>(`select game_id, market, side from bet_picks where sport_id=$1 and season_year=$2 and kind='live' and stat is null and model_version like 'bets-%'`, [s.id, season]))
    ours.set(`${b.game_id}|${b.market}`, b.side);
  const sd = SD[s.id];
  let matched = 0, rows = 0, flagged = 0;
  for (const e of events) {
    const h = matchTeam(e.home_team, teams), a = matchTeam(e.away_team, teams);
    if (!h || !a) continue;
    const t = new Date(e.commence_time).getTime() / 1000;
    const g = games.find((x: any) => Number(x.h) === h && Number(x.a) === a && Math.abs(Number(x.t) - t) < 6 * 3600);
    if (!g) continue;
    matched++;
    const per: Row[] = [];
    for (const b of e.bookmakers ?? []) {
      const row: Row = { key: b.key, book: bookName(String(b.title ?? b.key)), title: String(b.title ?? b.key), upd: Date.parse(b.last_update ?? '') || 0, sharp: SHARP.has(b.key), spread: null, hsp: null, asp: null, total: null, op: null, up: null, hml: null, aml: null };
      for (const m of b.markets ?? []) for (const o of m.outcomes ?? []) {
        const home = o.name === e.home_team;
        if (m.key === 'spreads') { if (home) { row.spread = o.point; row.hsp = o.price; } else row.asp = o.price; }
        if (m.key === 'totals') { if (o.name === 'Over') { row.total = o.point; row.op = o.price; } else row.up = o.price; }
        if (m.key === 'h2h') { if (home) row.hml = o.price; else row.aml = o.price; }
      }
      per.push(row);
    }
    for (const r of per) {
      await q(`insert into game_lines(game_id, source, book, phase, spread, home_spread_price, away_spread_price, total, over_price, under_price, home_ml, away_ml, updated_at)
               values ($1,'oddsapi',$2,'current',$3,$4,$5,$6,$7,$8,$9,$10,now())
               on conflict (game_id, source, book, phase) do update set spread=excluded.spread, home_spread_price=excluded.home_spread_price, away_spread_price=excluded.away_spread_price,
                 total=excluded.total, over_price=excluded.over_price, under_price=excluded.under_price, home_ml=excluded.home_ml, away_ml=excluded.away_ml, updated_at=now()`,
        [g.id, r.book, r.spread, r.hsp, r.asp, r.total, r.op, r.up, r.hml, r.aml]);
      await q(`insert into line_snapshots(game_id, source, book, spread, home_spread_price, away_spread_price, total, over_price, under_price, home_ml, away_ml)
               select $1,'oddsapi',$2,$3,$4,$5,$6,$7,$8,$9,$10 where not exists (select 1 from (select * from line_snapshots where game_id=$1 and source='oddsapi' and book=$2 order by taken_at desc limit 1) l
                 where l.spread is not distinct from $3::numeric and l.total is not distinct from $6::numeric and l.home_ml is not distinct from $9::int and l.away_ml is not distinct from $10::int)`,
        [g.id, r.book, r.spread, r.hsp, r.asp, r.total, r.op, r.up, r.hml, r.aml]);
      rows++;
    }
    if (per.length < 4 || Number(g.t) * 1000 < Date.now() + 20 * 60e3) continue;
    const cands = valueBets(per, sd);
    // One flag per game and market: the side and book with the most value.
    const best = new Map<string, Cand>();
    for (const c of cands) { const k = c.market; if (!best.has(k) || best.get(k)!.ev < c.ev) best.set(k, c); }
    for (const c of best.values()) {
      const reasons: { key: string; text: string }[] = [
        { key: 'price', text: `${c.book} pays ${signed(c.price)}; a fair price is ${signed(amer(c.fair))}` },
        { key: 'ev', text: `About +${(c.ev * 100).toFixed(1)}% expected return per bet` },
        { key: 'ref', text: c.ref === 'sharp' ? `Fair price from the sharpest books (${c.refBooks.join(', ')})` : `Fair price from the middle of ${c.refBooks.length} books` },
      ];
      const mine = ours.get(`${g.id}|${c.market}`);
      if (mine) reasons.push({ key: 'model', text: mine === c.side ? 'Our model likes this side too' : 'Our model leans the other way' });
      const tier = c.ref === 'sharp' && c.ev >= STRONG_EV && mine !== undefined && mine === c.side ? 'strong' : 'value';
      const ins = await q(`insert into bet_picks(sport_id, season_year, game_id, kind, market, side, line, price, book, our_number, edge, cover_prob, tier, reasons, model_version, stat)
               values ($1,$2,$3,'live',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'value-v1','price') on conflict do nothing returning id`,
        [s.id, season, g.id, c.market, c.side, c.line, c.price, bookName(c.book), Math.round(c.fairLine * 10) / 10, Math.round(c.ev * 1000) / 10, Math.round(c.fair * 1000) / 1000, tier, JSON.stringify(reasons)]);
      if (ins.length) flagged++;
    }
  }
  console.log(`${s.id}: odds api ${events.length} events, ${matched} matched, ${rows} book lines, ${flagged} best prices flagged; ${left} credits left`);
}

// Every book's price on every side, against the fair price. Exported for testing.
export function valueBets(per: Row[], sd: { spread: number; total: number }): Cand[] {
  const out: Cand[] = [];
  const pick = (ok: (r: Row) => boolean) => { const all = per.filter(ok); const sh = all.filter((r) => r.sharp); return { ref: sh.length ? 'sharp' as const : 'median' as const, rs: sh.length ? sh : all, n: all.length }; };
  // Pinnacle is the sharpest by a distance; without it (most women's games) the bar sits halfway to the median's.
  const hasPin = per.some((r) => r.key === 'pinnacle');
  const minEv = (ref: string) => (ref === 'sharp' ? (hasPin ? MIN_EV_SHARP : (MIN_EV_SHARP + MIN_EV_MEDIAN) / 2) : MIN_EV_MEDIAN);
  const newest = Math.max(0, ...per.filter((r) => r.sharp).map((r) => r.upd));
  const usable = (r: Row) => !r.sharp && US_BOOKS.has(r.key) && (!newest || !r.upd || newest - r.upd < STALE_MS);
  // Spreads: each reference book implies a fair expected margin; average them, then price every book's number.
  {
    const { ref, rs, n } = pick((r) => r.spread != null && r.hsp != null && r.asp != null);
    if (n >= 3 && (ref === 'sharp' || rs.length >= 4)) {
      const mus = rs.map((r) => -r.spread! - sd.spread * PhiInv(1 - devig(r.hsp!, r.asp!)));
      const mu = ref === 'sharp' ? mus.reduce((x, y) => x + y, 0) / mus.length : median(mus);
      for (const r of per) {
        if (r.spread == null || r.hsp == null || r.asp == null || !usable(r)) continue;
        const pH = 1 - Phi((-r.spread - mu) / sd.spread);
        for (const [side, p, price] of [['home', pH, r.hsp], ['away', 1 - pH, r.asp]] as const) {
          const ev = p * dec(price) - 1;
          if (ev >= minEv(ref) && ev <= MAX_EV && Math.abs(-r.spread - mu) < 6) out.push({ market: 'spread', side, line: r.spread, price, book: r.title, fair: p, ev, fairLine: mu, ref, refBooks: rs.map((x) => x.title) });
        }
      }
    }
  }
  // Totals, the same way.
  {
    const { ref, rs, n } = pick((r) => r.total != null && r.op != null && r.up != null);
    if (n >= 3 && (ref === 'sharp' || rs.length >= 4)) {
      const mus = rs.map((r) => r.total! - sd.total * PhiInv(1 - devig(r.op!, r.up!)));
      const mu = ref === 'sharp' ? mus.reduce((x, y) => x + y, 0) / mus.length : median(mus);
      for (const r of per) {
        if (r.total == null || r.op == null || r.up == null || !usable(r)) continue;
        const pO = 1 - Phi((r.total - mu) / sd.total);
        for (const [side, p, price] of [['over', pO, r.op], ['under', 1 - pO, r.up]] as const) {
          const ev = p * dec(price) - 1;
          if (ev >= minEv(ref) && ev <= MAX_EV && Math.abs(r.total - mu) < 8) out.push({ market: 'total', side, line: r.total, price, book: r.title, fair: p, ev, fairLine: mu, ref, refBooks: rs.map((x) => x.title) });
        }
      }
    }
  }
  // Moneylines: the fair chance is the reference books' no-cut chance; skip big favorites (thin, noisy prices).
  {
    const { ref, rs, n } = pick((r) => r.hml != null && r.aml != null);
    if (n >= 3 && (ref === 'sharp' || rs.length >= 4)) {
      const ps = rs.map((r) => devig(r.hml!, r.aml!));
      const pH = ref === 'sharp' ? ps.reduce((x, y) => x + y, 0) / ps.length : median(ps);
      if (pH > 0.2 && pH < 0.8) for (const r of per) {
        if (r.hml == null || r.aml == null || !usable(r)) continue;
        for (const [side, p, price] of [['home', pH, r.hml], ['away', 1 - pH, r.aml]] as const) {
          const ev = p * dec(price) - 1;
          if (ev >= minEv(ref) && ev <= MAX_EV) out.push({ market: 'moneyline', side, line: null, price, book: r.title, fair: p, ev, fairLine: amer(p), ref, refBooks: rs.map((x) => x.title) });
        }
      }
    }
  }
  return out;
}
