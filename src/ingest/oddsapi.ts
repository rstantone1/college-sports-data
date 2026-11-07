// Lines from many sportsbooks at once (The Odds API), for line shopping and for spotting a book that's off the
// market. The sharpest public books (Pinnacle, Circa, BetOnline) set the consensus; a soft book a point or more
// off that number is the best-known reliable edge in betting, and it needs no model at all. Costs credits: one
// call per sport per market, so the daily job calls it a couple of times a day for men's hoops and football.
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';
import { bookName } from './lines.js';

const KEY = () => process.env.ODDS_API_KEY;
const SPORT_KEY: Record<string, string> = { mbb: 'basketball_ncaab', cfb: 'americanfootball_ncaaf' };
const SHARP = new Set(['pinnacle', 'circa', 'betonline', 'bookmaker', 'lowvig']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(state)\b/g, 'st').replace(/\s+/g, ' ').trim();
// "Colorado Buffaloes" -> try to match a team by its short name being a prefix of the book's name.
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

export async function refreshOddsApi(s: SportConfig, season: number) {
  const key = KEY(); const sk = SPORT_KEY[s.id];
  if (!key || !sk) return;
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/${sk}/odds?regions=us,us2,eu&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${key}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`odds api ${s.id}: ${res.status}`); return; }
  const left = res.headers.get('x-requests-remaining');
  const events: any[] = await res.json();
  const teams = (await q<any>(`select id, short_name n, display_name d from teams where sport_id=$1`, [s.id])).map((t) => ({ id: Number(t.id), n: t.n ?? '', d: t.d ?? '' }));
  const games = await q<any>(`select id, home_team_id h, away_team_id a, extract(epoch from start_time) t from games where sport_id=$1 and season_year=$2 and not completed and start_time between now() - interval '6 hours' and now() + interval '5 days'`, [s.id, season]);
  let matched = 0, rows = 0, outliers = 0;
  for (const e of events) {
    const h = matchTeam(e.home_team, teams), a = matchTeam(e.away_team, teams);
    if (!h || !a) continue;
    const t = new Date(e.commence_time).getTime() / 1000;
    const g = games.find((x: any) => Number(x.h) === h && Number(x.a) === a && Math.abs(Number(x.t) - t) < 6 * 3600);
    if (!g) continue;
    matched++;
    const per: { book: string; sharp: boolean; spread: number | null; hsp: number | null; asp: number | null; total: number | null; op: number | null; up: number | null; hml: number | null; aml: number | null }[] = [];
    for (const b of e.bookmakers ?? []) {
      const book = bookName(String(b.title ?? b.key)); const row = { book, sharp: SHARP.has(b.key), spread: null as number | null, hsp: null as number | null, asp: null as number | null, total: null as number | null, op: null as number | null, up: null as number | null, hml: null as number | null, aml: null as number | null };
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
    // Market consensus: the sharp books if we have any, else the median of all. A book a point or more off it
    // (1.5 in football) on the side that favors the bettor is flagged as a lean with the book named.
    const sp = per.filter((r) => r.spread != null);
    if (sp.length >= 3) {
      const ref = (sp.some((r) => r.sharp) ? sp.filter((r) => r.sharp) : sp).map((r) => r.spread!).sort((x, y) => x - y);
      const cons = ref[ref.length >> 1];
      const gap = s.id === 'cfb' ? 1.5 : 1;
      for (const r of sp) {
        const d = r.spread! - cons;   // + = this book gives the home side more points than the market
        if (Math.abs(d) < gap) continue;
        const side = d > 0 ? 'home' : 'away';
        const ins = await q(`insert into bet_picks(sport_id, season_year, game_id, kind, market, side, line, price, book, our_number, edge, cover_prob, tier, reasons, model_version)
                 values ($1,$2,$3,'live','spread',$4,$5,$6,$7,$8,$9,null,'lean',$10,'shop-v1') on conflict do nothing returning id`,
          [s.id, season, g.id, side, r.spread, side === 'home' ? r.hsp : r.asp, r.book, -cons, Math.abs(d),
           JSON.stringify([{ key: 'shop', text: `${r.book} is ${Math.abs(d)} pts better than the market's number for this side` }])]);
        if (ins.length) outliers++;
      }
    }
  }
  console.log(`${s.id}: odds api ${events.length} events, ${matched} matched, ${rows} book lines, ${outliers} off-market numbers flagged; ${left} credits left`);
}
