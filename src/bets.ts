// Flagged bets. For each game in the next day and a half that has a line, compare our number with the books',
// look at the situational factors we test, and flag the game when bets like it have won often enough in past
// seasons (replayed week by week, using only what was known before each game). A flagged bet is written once,
// before the game, and never changed; after the game it's graded, including how far the line moved after we
// flagged it (closing-line value), which is the quickest honest read on whether a bet was a good one.
import { q } from './db.js';
import type { SportConfig } from './sports.js';
import { predictMargin, type Rated } from './model/engine.js';
import { sportModel } from './model/pack.js';

export const BETS_VERSION = 'bets-v1';

// How often our side has covered, by how far our number was from the line, on seasons the model had not seen.
// Filled from the research runs (scratch/edge, not in the repo); a band with too few games or no edge is left out,
// so nothing is flagged there. `p` is that cover rate; tiers come from it.
type Band = { lo: number; hi: number; p: number; n: number };
export const BANDS: Record<string, { spread: Band[]; total: Band[] }> = {
  mbb: { spread: [], total: [] },
  // Women's: trained 2022-24, held out 2025-27; 4+ points off the opener won in each held-out season, with the line
  // moving toward us after the open (+1.4 to +3.7 points on average).
  wbb: {
    spread: [{ lo: 4, hi: 99, p: 0.556, n: 348 }],
    total: [{ lo: 4, hi: 6, p: 0.548, n: 284 }, { lo: 6, hi: 99, p: 0.59, n: 219 }],
  },
  // Football: nothing held up on 2022-26 (spreads or totals), so nothing is flagged.
  cfb: { spread: [], total: [] },
};
export const TIERS = [{ tier: 'best', p: 0.56 }, { tier: 'strong', p: 0.54 }, { tier: 'lean', p: 0.525 }] as const;
const tierFor = (p: number) => TIERS.find((t) => p >= t.p)?.tier ?? null;

const STATE_TZ: Record<string, number> = { AZ: -7, CO: -7, ID: -7, MT: -7, NM: -7, UT: -7, WY: -7, CA: -8, NV: -8, OR: -8, WA: -8, HI: -10, AK: -9 };
const tzOf = (st: string | null) => (st ? STATE_TZ[st] ?? (['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'].includes(st) ? -6 : -5) : null);
const HIGH = new Set(['laramie|WY', 'usaf academy|CO', 'air force academy|CO', 'colorado springs|CO', 'boulder|CO', 'fort collins|CO', 'denver|CO', 'greeley|CO',
  'albuquerque|NM', 'flagstaff|AZ', 'provo|UT', 'salt lake city|UT', 'logan|UT', 'ogden|UT', 'orem|UT', 'cedar city|UT', 'reno|NV', 'bozeman|MT', 'pocatello|ID']);
const isHigh = (city: string | null, st: string | null) => !!city && !!st && HIGH.has(`${city.toLowerCase()}|${st}`);

interface Slate { id: number; h: number; a: number; n: boolean; start: string; spread: string | null; total: string | null; spread_open: string | null;
  home_ml: number | null; away_ml: number | null; vc: string | null; vs: string | null; hn: string; an: string; hrest: number | null; arest: number | null;
  hstate: string | null; astate: string | null; hcity: string | null; acity: string | null }

export async function flagBets(s: SportConfig, season: number, rated: Rated) {
  const bands = BANDS[s.id];
  if (!bands || (!bands.spread.length && !bands.total.length)) { console.log(`${s.id}: no tested betting rule yet, nothing flagged`); return; }
  const m = sportModel(s);
  const games = await q<Slate>(
    `with home_town as (
       select distinct on (home_team_id) home_team_id tm, venue_city city, venue_state st
       from (select home_team_id, venue_city, venue_state, count(*) c from games
             where sport_id=$1 and season_year between $2-1 and $2 and not coalesce(neutral_site,false) and venue_state is not null
             group by 1,2,3) x order by home_team_id, c desc)
     select g.id, g.home_team_id h, g.away_team_id a, coalesce(g.neutral_site,false) n, g.start_time::text start, g.spread, g.total, g.spread_open,
            g.home_ml, g.away_ml, g.venue_city vc, g.venue_state vs, ht.short_name hn, at.short_name an,
            extract(epoch from g.start_time - (select max(x.start_time) from games x where x.completed and x.sport_id=$1 and (x.home_team_id=g.home_team_id or x.away_team_id=g.home_team_id) and x.start_time < g.start_time))/86400 hrest,
            extract(epoch from g.start_time - (select max(x.start_time) from games x where x.completed and x.sport_id=$1 and (x.home_team_id=g.away_team_id or x.away_team_id=g.away_team_id) and x.start_time < g.start_time))/86400 arest,
            hh.st hstate, ah.st astate, hh.city hcity, ah.city acity
     from games g join teams ht on ht.id=g.home_team_id join teams at on at.id=g.away_team_id
     left join home_town hh on hh.tm=g.home_team_id left join home_town ah on ah.tm=g.away_team_id
     where g.sport_id=$1 and g.season_year=$2 and not g.completed and g.start_time > now() and g.start_time < now() + interval '36 hours'
       and (g.spread is not null or g.total is not null)`, [s.id, season]);
  let n = 0;
  for (const g of games) {
    const H = rated.ratings.get(Number(g.h)), A = rated.ratings.get(Number(g.a));
    if (!H || !A) continue;
    const { margin, units } = predictMargin(m, rated, H, A, g.n);
    const add = m.unit === 'inning' || m.unit === 'minute';
    const total = ((add ? H.o + A.d - rated.L + A.o + H.d - rated.L : (H.o * A.d + A.o * H.d) / rated.L) * units) / m.scale;
    const spread = g.spread == null ? null : Number(g.spread), tot = g.total == null ? null : Number(g.total);
    // Reasons in plain words: how far apart we are, and any situation worth knowing.
    const why = (edge: number, side: string) => {
      const r: { key: string; text: string }[] = [{ key: 'edge', text: `We're ${Math.abs(edge).toFixed(1)} pts off the line` }];
      const rest = (x: number | null) => (x == null ? null : Math.min(10, x));
      const hr = rest(g.hrest), ar = rest(g.arest);
      if (hr != null && ar != null && Math.abs(hr - ar) >= 2) r.push({ key: 'rest', text: `${hr > ar ? g.hn : g.an} has ${Math.round(Math.abs(hr - ar))} more days of rest` });
      const venueHigh = isHigh(g.vc ?? g.hcity, g.vs ?? g.hstate), awayHigh = isHigh(g.acity, g.astate);
      if (venueHigh && !awayHigh) r.push({ key: 'altitude', text: `${g.an} playing at altitude` });
      const tzV = tzOf(g.vs ?? g.hstate), tzA = tzOf(g.astate);
      if (tzV != null && tzA != null && Math.abs(tzV - tzA) >= 2) r.push({ key: 'travel', text: `${g.an} traveling ${Math.abs(tzV - tzA)} time zones` });
      if (g.spread_open != null && spread != null && Number(g.spread_open) !== spread) {
        const towardHome = spread < Number(g.spread_open);
        const towardUs = (side === 'home') === towardHome;
        r.push({ key: 'move', text: `Line has moved ${towardUs ? 'our way' : 'against us'} since it opened` });
      }
      return r;
    };
    const place = async (market: 'spread' | 'total', side: string, line: number, our: number, edge: number, bandsFor: Band[], reasons: { key: string; text: string }[]) => {
      const b = bandsFor.find((x) => Math.abs(edge) >= x.lo && Math.abs(edge) < x.hi);
      if (!b) return;
      const tier = tierFor(b.p);
      if (!tier) return;
      const ins = await q(
        `insert into bet_picks(sport_id, season_year, game_id, kind, market, side, line, price, book, our_number, edge, cover_prob, tier, reasons, model_version)
         values ($1,$2,$3,'live',$4,$5,$6,null,null,$7,$8,$9,$10,$11,$12) on conflict do nothing returning id`,
        [s.id, season, g.id, market, side, line, our, Math.abs(edge), b.p, tier, JSON.stringify(reasons), BETS_VERSION]);
      if (ins.length) n++;
    };
    if (spread != null && bands.spread.length) {
      const edge = margin + spread;                      // + = we like the home side more than the books
      const side = edge > 0 ? 'home' : 'away';
      await place('spread', side, spread, margin, edge, bands.spread, why(edge, side));
    }
    if (tot != null && bands.total.length) {
      const edge = total - tot;
      await place('total', edge > 0 ? 'over' : 'under', tot, total, edge, bands.total, [{ key: 'edge', text: `Our total is ${Math.abs(edge).toFixed(1)} ${edge > 0 ? 'above' : 'below'} the line` }]);
    }
  }
  console.log(`${s.id} ${season}: ${n} bets flagged from ${games.length} games with lines`);
}

// Grade finished games: win/loss/push against the number we flagged, and how the line moved after we did.
export async function gradeBets(s: SportConfig, season: number) {
  const r = await q<{ n: string }>(
    `with done as (
       update bet_picks b set
         close_line = case b.market when 'spread' then g.spread when 'total' then g.total end,
         clv = case
           when b.market='spread' and b.side='home' then b.line - g.spread
           when b.market='spread' and b.side='away' then g.spread - b.line
           when b.market='total' and b.side='over' then g.total - b.line
           when b.market='total' and b.side='under' then b.line - g.total end,
         result = case
           when b.market='spread' then case sign((g.home_score - g.away_score + b.line) * case when b.side='home' then 1 else -1 end)
                                         when 1 then 'win' when -1 then 'loss' else 'push' end
           when b.market='total' then case sign((g.home_score + g.away_score - b.line) * case when b.side='over' then 1 else -1 end)
                                         when 1 then 'win' when -1 then 'loss' else 'push' end end,
         graded_at = now()
       from games g
       where g.id=b.game_id and b.sport_id=$1 and b.season_year=$2 and b.result is null and b.market in ('spread','total')
         and g.completed and g.home_score is not null
       returning 1)
     select count(*) n from done`, [s.id, season]);
  // Games called off: void the bet.
  await q(`update bet_picks b set result='void', graded_at=now() from games g where g.id=b.game_id and b.result is null and g.status ~* 'cancel|postpone' and g.start_time < now() - interval '2 days'`);
  console.log(`${s.id} ${season}: ${r[0]?.n ?? 0} bets graded`);
}

// Replayed bets for a season: for every finished game with a line, the side our model took (from the week-by-week
// replay, which only used games already played), graded against the opening line when we have it (that's the
// number a bet placed when lines first post would get) or the close otherwise. Games in a tested band carry its
// tier; the rest are plain picks (no tier), so the site can show both the best bets and every game.
export async function replayBets(s: SportConfig, season: number) {
  const bands = BANDS[s.id] ?? { spread: [], total: [] };
  const rows = await q<any>(
    `select g.id, g.home_score hs, g.away_score "as", g.start_time, g.spread, g.total, g.spread_open, g.total_open,
            p.margin, p.home_pts, p.away_pts
     from games g
     join lateral (select * from predictions p where p.game_id=g.id and p.kind in ('replay','live') and not p.estimated
                   order by (p.kind='replay') desc limit 1) p on true
     where g.sport_id=$1 and g.season_year=$2 and g.completed and g.home_score is not null and (g.spread is not null or g.total is not null)`, [s.id, season]);
  const out: any[] = [];
  const bandOf = (list: Band[], e: number) => list.find((b) => e >= b.lo && e < b.hi) ?? null;
  for (const r of rows) {
    const hs = Number(r.hs), as = Number(r.as), m = Number(r.margin);
    const total = r.home_pts != null && r.away_pts != null ? Number(r.home_pts) + Number(r.away_pts) : null;
    const made = new Date(new Date(r.start_time).getTime() - 2 * 3600e3).toISOString();
    if (r.spread != null || r.spread_open != null) {
      const useOpen = r.spread_open != null, line = Number(useOpen ? r.spread_open : r.spread), close = r.spread == null ? null : Number(r.spread);
      const edge = m + line, side = edge > 0 ? 1 : -1;
      if (Math.abs(edge) >= 0.5) {
        const x = side * (hs - as + line);
        const b = bandOf(bands.spread, Math.abs(edge));
        out.push({ market: 'spread', side: side > 0 ? 'home' : 'away', line, our: m, edge: Math.abs(edge), p: b?.p ?? null, tier: b ? tierFor(b.p) : null,
          close, clv: useOpen && close != null ? (side > 0 ? line - close : close - line) : null, result: x > 0 ? 'win' : x < 0 ? 'loss' : 'push', id: r.id, made,
          reasons: [{ key: 'edge', text: `We were ${Math.abs(edge).toFixed(1)} pts off the line` }] });
      }
    }
    if (total != null && (r.total != null || r.total_open != null)) {
      const useOpen = r.total_open != null, line = Number(useOpen ? r.total_open : r.total), close = r.total == null ? null : Number(r.total);
      const edge = total - line, side = edge > 0 ? 1 : -1;
      if (Math.abs(edge) >= 0.5) {
        const x = side * (hs + as - line);
        const b = bandOf(bands.total, Math.abs(edge));
        out.push({ market: 'total', side: side > 0 ? 'over' : 'under', line, our: total, edge: Math.abs(edge), p: b?.p ?? null, tier: b ? tierFor(b.p) : null,
          close, clv: useOpen && close != null ? (side > 0 ? close - line : line - close) : null, result: x > 0 ? 'win' : x < 0 ? 'loss' : 'push', id: r.id, made,
          reasons: [{ key: 'edge', text: `Our total was ${Math.abs(edge).toFixed(1)} ${side > 0 ? 'above' : 'below'} the line` }] });
      }
    }
  }
  await q(`delete from bet_picks where sport_id=$1 and season_year=$2 and kind='replay'`, [s.id, season]);
  for (let i = 0; i < out.length; i += 500) {
    const c = out.slice(i, i + 500);
    await q(
      `insert into bet_picks(sport_id, season_year, game_id, kind, market, side, line, our_number, edge, cover_prob, tier, reasons, model_version, made_at, close_line, clv, result, graded_at)
       select $1, $2, g, 'replay', mk, sd, ln, ou, ed, cp, tr, rs::jsonb, $3, ma::timestamptz, cl, cv, rt, now()
       from unnest($4::bigint[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::text[], $13::text[], $14::numeric[], $15::numeric[], $16::text[])
            as x(g, mk, sd, ln, ou, ed, cp, tr, rs, ma, cl, cv, rt)
       on conflict do nothing`,
      [s.id, season, BETS_VERSION, c.map((x) => x.id), c.map((x) => x.market), c.map((x) => x.side), c.map((x) => x.line), c.map((x) => Math.round(x.our * 10) / 10),
       c.map((x) => Math.round(x.edge * 10) / 10), c.map((x) => x.p), c.map((x) => x.tier), c.map((x) => JSON.stringify(x.reasons)), c.map((x) => x.made),
       c.map((x) => x.close), c.map((x) => (x.clv == null ? null : Math.round(x.clv * 10) / 10)), c.map((x) => x.result)]);
  }
  const flagged = out.filter((x) => x.tier && x.tier !== 'lean');
  const rec = (xs: any[]) => { const w = xs.filter((x) => x.result === 'win').length, l = xs.filter((x) => x.result === 'loss').length; return `${w}-${l} (${w + l ? ((w / (w + l)) * 100).toFixed(1) : '–'}%)`; };
  console.log(`${s.id} ${season}: ${out.length} replayed picks; every game ATS ${rec(out.filter((x) => x.market === 'spread'))}, totals ${rec(out.filter((x) => x.market === 'total'))}; best bets ${rec(flagged)}`);
}
