// Betting lines. ESPN's core odds feed lists every book it carries for a game: real sportsbooks (5Dimes, Bovada,
// DraftKings, Caesars, ESPN BET ...), an "Opening" line in older seasons, ESPN's own "consensus", and model
// projections (teamrankings, numberfire, accuscore). Newer games carry opening, closing and current numbers per book.
//
// ESPN's consensus is wrong on a share of older neutral-site games: it names the wrong team as the favorite. So the
// game's line is the median of the real books, and every line is checked against how the market priced both teams
// in all of that season's other games. A line that only makes sense with the sign flipped is flipped; one that
// makes no sense either way is dropped. Our own model is never used to judge the market.
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';

const CORE = 'https://sports.core.api.espn.com/v2/sports';
const DELAY = Number(process.env.LINES_DELAY_MS ?? 120);
const UA = 'college-sports-data/0.1 (research; contact via repo)';

let last = 0;
async function pace() {
  const wait = last + DELAY - Date.now();
  last = Math.max(Date.now(), last + DELAY);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
async function getJson(url: string, attempt = 1): Promise<any> {
  await pace();
  let res: Response;
  try { res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { if (attempt >= 4) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)); return getJson(url, attempt + 1); }
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`ESPN ${res.status} after ${attempt} tries: ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${url}`);
  return res.json();
}

const corePath = (s: SportConfig) => { const [sport, league] = s.espnPath.split('/'); return `${CORE}/${sport}/leagues/${league}`; };
export const fetchCoreOdds = (s: SportConfig, espnId: string) =>
  getJson(`${corePath(s)}/events/${espnId}/competitions/${espnId}/odds?limit=100`);

// ---------- parsing ----------

export type Kind = 'book' | 'opening' | 'consensus' | 'projection';
export interface Quote {
  book: string; kind: Kind; phase: 'open' | 'close' | 'current';
  spread: number | null;            // home team's view: negative = home favored
  total: number | null;
  hml: number | null; aml: number | null;          // moneylines
  hsp: number | null; asp: number | null;          // spread prices
  op: number | null; up: number | null;            // over / under prices
}

const ALIASES: [RegExp, string][] = [
  [/^caesar|^william hill/i, 'caesars'], [/draft ?kings/i, 'draftkings'], [/^espn ?bet$/i, 'espn bet'], [/mgm/i, 'betmgm'],
  [/^fanduel/i, 'fanduel'], [/^bovada/i, 'bovada'], [/^5dimes/i, '5dimes'], [/^betonline/i, 'betonline'],
  [/^sportsbetting/i, 'sportsbetting'], [/^pointsbet/i, 'pointsbet'], [/^unibet/i, 'unibet'], [/^sugarhouse/i, 'sugarhouse'],
  [/^titanbet/i, 'titanbets'], [/^betfair/i, 'betfair'], [/^westgate/i, 'westgate'], [/^wynn/i, 'wynn'],
  [/^cg tech/i, 'cg technology'], [/^betradar/i, 'betradar'], [/^betus/i, 'betus'], [/^betnow/i, 'betnow'],
  [/^sportsinteraction/i, 'sportsinteraction'], [/^sportsbook\.com/i, 'sportsbook.com'], [/^fantasy911/i, 'fantasy911'],
  [/^bet365/i, 'bet365'], [/^fanatics/i, 'fanatics'], [/^hard ?rock/i, 'hard rock'], [/^bally/i, 'bally bet'],
];
export function bookName(raw: string): string {
  const n = raw.trim();
  for (const [re, name] of ALIASES) if (re.test(n)) return name;
  return n.toLowerCase();
}
export function kindOf(raw: string): Kind | null {
  if (/live/i.test(raw)) return null;                                   // in-game lines: never a pregame number
  if (/^opening$/i.test(raw)) return 'opening';
  if (/^consensus$/i.test(raw)) return 'consensus';
  if (/teamrankings|numberfire|accuscore|fantasy ?pros|fpi|bpi/i.test(raw)) return 'projection';
  return 'book';
}

const amer = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 100;
  if (s === 'PK' || s === 'PICK') return 0;
  const x = Number(s.replace('+', ''));
  return Number.isFinite(x) ? x : null;
};
const okTotal = (t: number | null) => (t != null && t > 20 ? t : null);
const okSpread = (x: number | null) => (x != null && Math.abs(x) < 80 ? x : null);
const teamIdOf = (ref: unknown) => { const m = /\/teams\/(\d+)/.exec(String(ref ?? '')); return m ? m[1] : null; };

// "ALA -4" -> {abbr: 'ALA', pts: -4}; "EVEN" / "PK" -> pick'em
function parseDetails(d: unknown): { abbr: string; pts: number } | 'pk' | null {
  if (typeof d !== 'string') return null;
  const s = d.trim();
  if (/^(even|pk|pick'?em|pick)$/i.test(s)) return 'pk';
  const m = /^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return { abbr: m[1].trim().toUpperCase(), pts: Number(m[2]) };
}

export interface GameRef { espnId: string; homeEspn: string; awayEspn: string; homeAbbr: string; awayAbbr: string }

export function parseCoreItems(items: any[], g: GameRef): Quote[] {
  const out: Quote[] = [];
  for (const it of items ?? []) {
    const raw = String(it?.provider?.name ?? '');
    const kind = kindOf(raw);
    if (!raw || !kind) continue;
    const book = kind === 'book' ? bookName(raw) : raw.toLowerCase();
    // Is this item's "home" the game's home team? Older feeds name teams by reference; trust that first.
    const hRef = teamIdOf(it?.homeTeamOdds?.team?.$ref), aRef = teamIdOf(it?.awayTeamOdds?.team?.$ref);
    const reversed = hRef != null && aRef != null && hRef === g.awayEspn && aRef === g.homeEspn;
    const orient = (x: number | null) => (x == null ? null : reversed ? -x : x);

    // The favorite named in the details string is the clearest statement of what the book meant.
    const det = parseDetails(it?.details);
    let detSpread: number | null = null;
    if (det === 'pk') detSpread = 0;
    else if (det) {
      const fav = det.abbr;
      if (fav === g.homeAbbr.toUpperCase()) detSpread = -Math.abs(det.pts);
      else if (fav === g.awayAbbr.toUpperCase()) detSpread = Math.abs(det.pts);
    }

    const phases: ('open' | 'close' | 'current')[] = ['open', 'close', 'current'];
    let any = false;
    for (const ph of phases) {
      const h = it?.homeTeamOdds?.[ph], a = it?.awayTeamOdds?.[ph], tot = it?.[ph];
      if (!h && !a && !tot) continue;
      let sp = amer(h?.pointSpread?.american);
      if (sp == null) { const x = amer(a?.pointSpread?.american); sp = x == null ? null : -x; }
      sp = orient(sp);
      const qd: Quote = {
        book, kind, phase: ph, spread: okSpread(sp), total: okTotal(amer(tot?.total?.american)),
        hml: amer((reversed ? a : h)?.moneyLine?.american), aml: amer((reversed ? h : a)?.moneyLine?.american),
        hsp: amer((reversed ? a : h)?.spread?.american), asp: amer((reversed ? h : a)?.spread?.american),
        op: amer(tot?.over?.american), up: amer(tot?.under?.american),
      };
      if (qd.spread != null || qd.total != null || qd.hml != null) {
        // "Opening" is a provider whose every number is the opener.
        if (kind === 'opening') { if (!any) out.push({ ...qd, phase: 'open' }); } else out.push(qd);
        any = true;
      }
    }
    // Older items carry only a single number: the line as it stood at kickoff (or the opener, for "Opening").
    if (!any) {
      let sp = detSpread ?? orient(amer(it?.spread));
      const qd: Quote = {
        book, kind, phase: kind === 'opening' ? 'open' : 'close', spread: okSpread(sp), total: okTotal(amer(it?.overUnder)),
        hml: amer((reversed ? it?.awayTeamOdds : it?.homeTeamOdds)?.moneyLine), aml: amer((reversed ? it?.homeTeamOdds : it?.awayTeamOdds)?.moneyLine),
        hsp: amer((reversed ? it?.awayTeamOdds : it?.homeTeamOdds)?.spreadOdds), asp: amer((reversed ? it?.homeTeamOdds : it?.awayTeamOdds)?.spreadOdds),
        op: amer(it?.overOdds), up: amer(it?.underOdds),
      };
      if (qd.spread != null || qd.total != null || qd.hml != null) out.push(qd);
    }
  }
  return out;
}

// Lines ESPN stored in its game summaries (pickcenter) before we read the core feed.
export function parsePickcenter(raw: any[] | null, g: GameRef): Quote[] {
  const out: Quote[] = [];
  for (const x of raw ?? []) {
    const name = String(x?.provider ?? '');
    const kind = kindOf(name);
    if (!name || !kind) continue;
    const det = parseDetails(x?.details);
    let sp: number | null = x?.spread == null ? null : Number(x.spread);
    if (det === 'pk') sp = 0;
    else if (det && det.abbr === g.homeAbbr.toUpperCase()) sp = -Math.abs(det.pts);
    else if (det && det.abbr === g.awayAbbr.toUpperCase()) sp = Math.abs(det.pts);
    out.push({ book: kind === 'book' ? bookName(name) : name.toLowerCase(), kind, phase: 'close', spread: okSpread(sp),
      total: okTotal(x?.overUnder == null ? null : Number(x.overUnder)), hml: x?.homeML || null, aml: x?.awayML || null,
      hsp: null, asp: null, op: null, up: null });
  }
  return out;
}

// ---------- summarising a game's lines ----------

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number | null, step = 0.5) => (x == null ? null : Math.round(x / step) * step);

export interface Summary {
  spread: number | null; total: number | null; spreadOpen: number | null; totalOpen: number | null;
  hml: number | null; aml: number | null; books: number; provider: string | null; flag: string | null;
}

// Market lines only (real books first, then ESPN consensus). Projections are other people's models, not prices.
function closeOf(qs: Quote[], field: 'spread' | 'total' | 'hml' | 'aml') {
  const pick = (ks: Kind[]) => {
    const byBook = new Map<string, number>();
    for (const ph of ['close', 'current'] as const)
      for (const x of qs) if (ks.includes(x.kind) && x.phase === ph && x[field] != null && !byBook.has(x.book)) byBook.set(x.book, x[field]!);
    return [...byBook.values()];
  };
  const books = pick(['book']);
  if (books.length) return { v: median(books), n: books.length, from: 'books' };
  const cons = pick(['consensus']);
  if (cons.length) return { v: median(cons), n: 0, from: 'consensus' };
  return { v: null, n: 0, from: null as string | null };
}
function openOf(qs: Quote[], field: 'spread' | 'total') {
  const vals = qs.filter((x) => x.phase === 'open' && x[field] != null && (x.kind === 'book' || x.kind === 'opening')).map((x) => x[field]!);
  return median(vals);
}

export function summarize(qs: Quote[]): Summary {
  const sp = closeOf(qs, 'spread'), tot = closeOf(qs, 'total');
  const hml = closeOf(qs, 'hml'), aml = closeOf(qs, 'aml');
  return {
    spread: round(sp.v), total: round(tot.v), spreadOpen: round(openOf(qs, 'spread')), totalOpen: round(openOf(qs, 'total')),
    hml: hml.v == null ? null : Math.round(hml.v), aml: aml.v == null ? null : Math.round(aml.v),
    books: sp.n, provider: sp.from, flag: null,
  };
}

// ---------- market-consistency check ----------
// Fit one rating per team (plus home edge) to the season's lines, down-weighting lines that don't fit. Then each
// game's line is compared with what the rest of the market implies for that matchup.
export function marketFit(games: { id: number; h: number; a: number; n: boolean; v: number }[]) {
  const teams = new Set<number>(); for (const g of games) { teams.add(g.h); teams.add(g.a); }
  const r = new Map<number, number>([...teams].map((t) => [t, 0]));
  let H = 0; const w = new Map<number, number>(games.map((g) => [g.id, 1]));
  for (let pass = 0; pass < 6; pass++) {
    for (let it = 0; it < 40; it++) {
      const sum = new Map<number, number>(), wt = new Map<number, number>();
      let hs = 0, hw = 0;
      for (const g of games) {
        const ww = w.get(g.id)!;
        const res = g.v - (r.get(g.h)! - r.get(g.a)! + (g.n ? 0 : H));
        sum.set(g.h, (sum.get(g.h) ?? 0) + ww * res); wt.set(g.h, (wt.get(g.h) ?? 0) + ww);
        sum.set(g.a, (sum.get(g.a) ?? 0) - ww * res); wt.set(g.a, (wt.get(g.a) ?? 0) + ww);
        if (!g.n) { hs += ww * res; hw += ww; }
      }
      for (const t of teams) r.set(t, r.get(t)! + (sum.get(t) ?? 0) / Math.max(1, wt.get(t) ?? 0) * 0.9);
      if (hw) H += (hs / hw) * 0.9;
      const mean = [...r.values()].reduce((a, b) => a + b, 0) / r.size;
      for (const t of teams) r.set(t, r.get(t)! - mean);
    }
    // Huber weights: lines far from the fit count less on the next pass.
    for (const g of games) {
      const res = Math.abs(g.v - (r.get(g.h)! - r.get(g.a)! + (g.n ? 0 : H)));
      w.set(g.id, res <= 4 ? 1 : 4 / res);
    }
  }
  const pred = (h: number, a: number, n: boolean) => (r.has(h) && r.has(a) ? r.get(h)! - r.get(a)! + (n ? 0 : H) : null);
  const resid = games.map((g) => g.v - pred(g.h, g.a, g.n)!);
  const mad = median(resid.map(Math.abs)) ?? 3;
  return { pred, H, sd: mad * 1.4826 };
}

// Decide, line by line, whether each quote fits the market's picture of the matchup, is the mirror image of it
// (favorite swapped), or fits neither. Returns the cleaned quotes and what was done.
export function cleanQuotes(qs: Quote[], pred: number | null, sport: string): { qs: Quote[]; flipped: number; dropped: number } {
  if (pred == null) return { qs, flipped: 0, dropped: 0 };
  const far = sport === 'cfb' ? 18 : 15;
  const bad = sport === 'cfb' ? 8 : 7;
  let flipped = 0, dropped = 0;
  const out: Quote[] = [];
  for (const x of qs) {
    if (x.spread == null || Math.abs(pred) < 3) { out.push(x); continue; }
    const v = -x.spread;                       // home margin the line implies
    const r = Math.abs(v - pred), rf = Math.abs(-v - pred);
    if (r > bad && rf < r / 3) { out.push({ ...x, spread: -x.spread }); flipped++; continue; }
    if (Math.min(r, rf) > far) { out.push({ ...x, spread: null }); dropped++; continue; }
    out.push(x);
  }
  return { qs: out, flipped, dropped };
}

// ---------- CollegeFootballData (football): several books with openers, matched by ESPN game id ----------
export async function fetchCfbdLines(season: number): Promise<Map<string, Quote[]>> {
  const key = process.env.CFBD_API_KEY;
  const out = new Map<string, Quote[]>();
  if (!key) return out;
  for (const type of ['regular', 'postseason']) {
    const res = await fetch(`https://api.collegefootballdata.com/lines?year=${season}&seasonType=${type}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!res.ok) { console.warn(`cfbd lines ${season} ${type}: ${res.status}`); continue; }
    for (const g of (await res.json()) as any[]) {
      const qs: Quote[] = [];
      for (const l of g.lines ?? []) {
        const kind = kindOf(String(l.provider ?? ''));
        if (!kind) continue;
        const book = kind === 'book' ? bookName(String(l.provider)) : String(l.provider).toLowerCase();
        qs.push({ book, kind, phase: 'close', spread: okSpread(l.spread ?? null), total: okTotal(l.overUnder ?? null),
          hml: l.homeMoneyline ?? null, aml: l.awayMoneyline ?? null, hsp: null, asp: null, op: null, up: null });
        if (l.spreadOpen != null || l.overUnderOpen != null)
          qs.push({ book, kind, phase: 'open', spread: okSpread(l.spreadOpen ?? null), total: okTotal(l.overUnderOpen ?? null),
            hml: null, aml: null, hsp: null, asp: null, op: null, up: null });
      }
      if (qs.length) out.set(String(g.id), qs);
    }
  }
  return out;
}

// ---------- jobs ----------

interface GameRow { id: number; espn_id: string; neutral: boolean; h: number; a: number; h_espn: string; a_espn: string; h_abbr: string; a_abbr: string; completed: boolean; start: string; odds: any[] | null; old_spread: string | null }

async function gamesFor(s: SportConfig, season: number, mode: 'season' | 'upcoming') {
  return q<GameRow>(
    `select g.id, g.espn_id, coalesce(g.neutral_site,false) neutral, g.home_team_id h, g.away_team_id a, ht.espn_id h_espn, at.espn_id a_espn,
            coalesce(ht.abbreviation,'') h_abbr, coalesce(at.abbreviation,'') a_abbr, g.completed, g.start_time::text start, g.odds, g.spread::text old_spread
     from games g join teams ht on ht.id=g.home_team_id join teams at on at.id=g.away_team_id
     where g.sport_id=$1 and g.season_year=$2 and g.espn_id is not null
       and ($3 = 'season' and g.completed
            or $3 = 'upcoming' and g.start_time between now() - interval '18 hours' and now() + interval '4 days'
                               and (not g.completed or g.lines_checked_at is null or g.lines_checked_at < g.start_time + interval '3 hours'))
     order by g.start_time`, [s.id, season, mode]);
}

async function writeSummaries(rows: { id: number; s: Summary }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const c = rows.slice(i, i + 500);
    await q(
      `update games g set spread=v.spread, total=v.total, spread_open=v.so, total_open=v.tot_o, line_books=v.nb,
              odds_provider=v.prov, line_flag=v.flag, lines_checked_at=now()
       from unnest($1::bigint[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[], $6::int[], $7::text[], $8::text[])
            as v(id, spread, total, so, tot_o, nb, prov, flag)
       where g.id=v.id`,
      [c.map((r) => r.id), c.map((r) => r.s.spread), c.map((r) => r.s.total), c.map((r) => r.s.spreadOpen), c.map((r) => r.s.totalOpen),
       c.map((r) => r.s.books), c.map((r) => r.s.provider), c.map((r) => r.s.flag)]);
    await q(`update games g set home_ml=v.hml, away_ml=v.aml from unnest($1::bigint[], $2::int[], $3::int[]) as v(id, hml, aml) where g.id=v.id`,
      [c.map((r) => r.id), c.map((r) => r.s.hml), c.map((r) => r.s.aml)]);
  }
}

// Per-book rows for current games (line shopping on the site) and a snapshot whenever a book's number changes.
async function writeBookRows(gameId: number, qs: Quote[]) {
  for (const x of qs) {
    if (x.kind === 'projection') continue;
    await q(
      `insert into game_lines(game_id, source, book, phase, spread, home_spread_price, away_spread_price, total, over_price, under_price, home_ml, away_ml, updated_at)
       values ($1,'espn',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       on conflict (game_id, source, book, phase) do update set spread=excluded.spread, home_spread_price=excluded.home_spread_price,
         away_spread_price=excluded.away_spread_price, total=excluded.total, over_price=excluded.over_price, under_price=excluded.under_price,
         home_ml=excluded.home_ml, away_ml=excluded.away_ml, updated_at=now()`,
      [gameId, x.book, x.phase, x.spread, x.hsp, x.asp, x.total, x.op, x.up, x.hml, x.aml]);
    if (x.phase !== 'current') continue;
    await q(
      `insert into line_snapshots(game_id, source, book, spread, home_spread_price, away_spread_price, total, over_price, under_price, home_ml, away_ml)
       select $1,'espn',$2,$3,$4,$5,$6,$7,$8,$9,$10
       where not exists (
         select 1 from (select * from line_snapshots where game_id=$1 and source='espn' and book=$2 order by taken_at desc limit 1) l
         where l.spread is not distinct from $3::numeric and l.total is not distinct from $6::numeric
           and l.home_ml is not distinct from $9::int and l.away_ml is not distinct from $10::int)`,
      [gameId, x.book, x.spread, x.hsp, x.asp, x.total, x.op, x.up, x.hml, x.aml]);
  }
}

// Season backfill: fetch every finished game's lines, clean them against the market, save the summary on each game,
// and (optionally) write every book's numbers to a research file. Per-book rows stay out of the database.
export async function backfillLines(s: SportConfig, season: number, opts: { out?: string; workers?: number } = {}) {
  const games = await gamesFor(s, season, 'season');
  console.log(`${s.id} ${season}: ${games.length} finished games`);
  const cfbd = s.id === 'cfb' ? await fetchCfbdLines(season) : new Map<string, Quote[]>();
  if (cfbd.size) console.log(`cfbd: lines for ${cfbd.size} games`);
  const quotes = new Map<number, Quote[]>();
  let next = 0, done = 0, withAny = 0, failed = 0;
  const worker = async () => {
    while (next < games.length) {
      const g = games[next++];
      const ref: GameRef = { espnId: g.espn_id, homeEspn: String(g.h_espn), awayEspn: String(g.a_espn), homeAbbr: g.h_abbr, awayAbbr: g.a_abbr };
      let qs: Quote[] = [];
      try { const j = await fetchCoreOdds(s, g.espn_id); qs = parseCoreItems(j?.items ?? [], ref); }
      catch (e) { failed++; if (failed < 20) console.warn(`odds ${g.espn_id}: ${(e as Error).message}`); }
      // Fill in from what we already had: ESPN summaries (old consensus) and CollegeFootballData.
      const have = new Set(qs.map((x) => `${x.book}|${x.phase}`));
      for (const x of [...parsePickcenter(g.odds, ref), ...(cfbd.get(g.espn_id) ?? [])]) {
        if (!have.has(`${x.book}|${x.phase}`)) { qs.push(x); have.add(`${x.book}|${x.phase}`); }
      }
      if (qs.length) { quotes.set(g.id, qs); withAny++; }
      if (++done % 500 === 0) console.log(`${s.id} ${season}: ${done}/${games.length} fetched, ${withAny} with lines`);
    }
  };
  await Promise.all(Array.from({ length: opts.workers ?? 3 }, worker));

  // First pass: raw summaries feed the market fit; second pass: clean every quote against the fit and re-summarise.
  const raw = games.map((g) => ({ g, s: summarize(quotes.get(g.id) ?? []) }));
  const fitGames = raw.filter((x) => x.s.spread != null).map((x) => ({ id: x.g.id, h: Number(x.g.h), a: Number(x.g.a), n: x.g.neutral, v: -x.s.spread! }));
  const fit = marketFit(fitGames);
  const priced = new Map<number, number>();
  for (const x of fitGames) { priced.set(x.h, (priced.get(x.h) ?? 0) + 1); priced.set(x.a, (priced.get(x.a) ?? 0) + 1); }
  let flippedGames = 0, droppedQuotes = 0, flippedQuotes = 0;
  const final: { id: number; s: Summary }[] = [];
  const research: any[] = [];
  for (const { g, s: s0 } of raw) {
    const qs0 = quotes.get(g.id) ?? [];
    const enough = (priced.get(Number(g.h)) ?? 0) >= 5 && (priced.get(Number(g.a)) ?? 0) >= 5;
    const pred = enough ? fit.pred(Number(g.h), Number(g.a), g.neutral) : null;
    const c = cleanQuotes(qs0, pred, s.id);
    const s1 = summarize(c.qs);
    flippedQuotes += c.flipped; droppedQuotes += c.dropped;
    // Compare with the line we had stored before (ESPN's consensus alone): did the favorite change?
    const old = g.old_spread == null ? null : Number(g.old_spread);
    const corrected = old != null && s1.spread != null && Math.sign(old) !== Math.sign(s1.spread) && Math.abs(old - s1.spread) > 2;
    if (corrected) flippedGames++;
    // Opener on the same footing as the close: an opener that only fits with the favorite swapped is swapped.
    if (s1.spread != null && s1.spreadOpen != null && Math.abs(s1.spreadOpen - s1.spread) > 7 && Math.abs(-s1.spreadOpen - s1.spread) < 3) s1.spreadOpen = -s1.spreadOpen;
    if (corrected) s1.flag = 'corrected';
    if (s1.spread == null && (s0.spread != null || old != null)) s1.flag = 'dropped';
    final.push({ id: g.id, s: s1 });
    if (opts.out && qs0.length) research.push({ id: g.id, espn: g.espn_id, t: g.start, q: c.qs, s: s1 });
  }
  console.log(`${s.id} ${season}: ${withAny}/${games.length} games with lines, ${failed} fetch errors; market fit home edge ${fit.H.toFixed(2)}, spread of lines around the fit ${fit.sd.toFixed(2)}; quotes flipped ${flippedQuotes}, dropped ${droppedQuotes}; games whose favorite changed from what we had stored ${flippedGames}`);
  await writeSummaries(final);
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, gzipSync(JSON.stringify({ sport: s.id, season, games: research })));
    console.log(`research file: ${opts.out} (${research.length} games)`);
  }
}

// Current games: every run, refresh the next few days' lines (and close out games that just finished).
export async function refreshLines(s: SportConfig, season: number) {
  const games = await gamesFor(s, season, 'upcoming');
  let withLines = 0;
  const rows: { id: number; s: Summary }[] = [];
  for (const g of games) {
    const ref: GameRef = { espnId: g.espn_id, homeEspn: String(g.h_espn), awayEspn: String(g.a_espn), homeAbbr: g.h_abbr, awayAbbr: g.a_abbr };
    let qs: Quote[] = [];
    try { const j = await fetchCoreOdds(s, g.espn_id); qs = parseCoreItems(j?.items ?? [], ref); }
    catch (e) { console.warn(`odds ${g.espn_id}: ${(e as Error).message}`); continue; }
    if (!qs.length) continue;
    withLines++;
    await writeBookRows(g.id, qs);
    rows.push({ id: g.id, s: summarize(qs) });
  }
  await writeSummaries(rows);
  // Games we looked at with nothing posted yet: note the check so finished games aren't re-polled forever.
  const none = games.filter((g) => !rows.some((r) => r.id === g.id) && g.completed).map((g) => g.id);
  if (none.length) await q(`update games set lines_checked_at=now() where id = any($1::bigint[])`, [none]);
  console.log(`${s.id} ${season}: lines for ${withLines} of ${games.length} current games`);
}
