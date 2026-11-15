import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { restAll, toBet, type Bet } from '../api';
import { useAsync, fmtDate, fmtTime } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { betText, TIER, bookLabel, sideNum, isPrice, oddsText, fairOdds } from '../components/Lines';
import { SPORTS, sportMeta } from '../sports';

// Units won on one bet of one unit at the posted price (-110 when no price was posted).
const units = (b: Bet) => (b.result === 'win' ? (b.price == null ? 100 / 110 : b.price > 0 ? b.price / 100 : 100 / -b.price) : b.result === 'loss' ? -1 : 0);
function record(bs: Bet[]) {
  const w = bs.filter((b) => b.result === 'win').length, l = bs.filter((b) => b.result === 'loss').length, p = bs.filter((b) => b.result === 'push').length;
  const u = bs.reduce((a, b) => a + units(b), 0);
  const clvs = bs.map((b) => b.clv).filter((x): x is number => x != null);
  return { w, l, p, n: w + l, rate: w + l ? w / (w + l) : NaN, u, clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null };
}
const pctTxt = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');
const uTxt = (u: number) => `${u >= 0 ? '+' : '−'}${Math.abs(u).toFixed(1)}`;

// Best bets: where our number and the sportsbooks disagree enough to matter, with the reasons. Every bet is locked
// in before the game and graded after, good or bad, so the record below is the real one.
export function BetsPage() {
  const [sport, setSport] = useState('all');
  const data = useAsync(() => Promise.all([
    restAll<any>(`v_bets?kind=eq.live&order=start_time.asc`),
    restAll<any>(`v_bets?kind=eq.replay&tier=in.(best,strong)&result=not.is.null&order=start_time.asc`),
  ]).then(([live, rep]) => ({ live: live.map(toBet), replay: rep.map(toBet) })), []);

  const view = useMemo(() => {
    const cur = (b: Bet) => b.season_year === sportMeta(b.sport_id).seasons[0].year;
    const pick = (b: Bet) => sport === 'all' || b.sport_id === sport;
    const liveAll = (data.data?.live ?? []).filter(pick);
    const live = liveAll.filter((b) => !isPrice(b));
    const priced = liveAll.filter(isPrice);
    const replay = (data.data?.replay ?? []).filter(pick);
    const isBest = (b: Bet) => b.tier === 'best' || b.tier === 'strong';
    const now = Date.now();
    const soon = (b: Bet) => !b.completed && new Date(b.start_time).getTime() > now - 3 * 3600e3;
    const upcoming = live.filter((b) => soon(b) && isBest(b));
    // Where our number and the line disagree most. Shown as a second opinion, not graded as picks.
    const gaps = live.filter((b) => soon(b) && b.tier === 'lean').sort((a, b) => b.edge - a.edge).slice(0, 6);
    // This season's best bets: replayed picks (what we'd have flagged, graded against the real line) plus live ones.
    const season = [...replay.filter(cur), ...live.filter((b) => b.result)].filter(isBest).sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    const past = replay.filter((b) => !cur(b) && isBest(b));
    // Prices our model agrees with first, then by expected return.
    const agree = (b: Bet) => (b.reasons?.some((r) => r.key === 'model' && /too/.test(r.text)) ? 1 : 0);
    const prices = priced.filter(soon).sort((a, b) => agree(b) - agree(a) || b.edge - a.edge).slice(0, 12);
    const priceRec = priced.filter((b) => b.result && b.result !== 'void');
    const graded = [...priceRec, ...season].sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    return { prices, priceRec, upcoming, gaps, season, past, graded, liveCount: live.filter((b) => b.result && isBest(b)).length };
  }, [data.data, sport]);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error} />;
  const pr = record(view.priceRec);
  const live = record(view.season), past = record(view.past);
  const sportsWithBets = new Set([...(data.data?.live ?? []), ...(data.data?.replay ?? [])].map((b) => b.sport_id));
  const byDay = new Map<string, Bet[]>();
  for (const b of view.upcoming) { const d = fmtDate(b.start_time, { weekday: 'long', month: 'short', day: 'numeric' }); byDay.set(d, [...(byDay.get(d) ?? []), b]); }

  return (
    <>
      <Back />
      <h1>Bets</h1>
      <p className="sub">Two kinds, both written down before the game and graded after: prices a sportsbook got wrong, and the one model edge that held up when we tested it on past seasons.</p>
      <div className="chips">
        <button className={`chip ${sport === 'all' ? 'on' : ''}`} onClick={() => setSport('all')}>All sports</button>
        {Object.values(SPORTS).filter((s) => sportsWithBets.has(s.id)).map((s) => <button key={s.id} className={`chip ${sport === s.id ? 'on' : ''}`} onClick={() => setSport(s.id)}>{s.short}</button>)}
      </div>

      <div className="cards" style={{ marginBottom: 18 }}>
        <div className="card"><div className="k">Best prices</div><div className="v">{pr.n ? `${uTxt(pr.u)}` : '–'}</div><div className="r">{pr.n ? `units · ${pr.w}-${pr.l}${pr.p ? `-${pr.p}` : ''}${pr.clv != null ? ` · beat the closing line by ${pr.clv.toFixed(1)} pts` : ''}` : 'checked every day'}</div></div>
        <div className="card"><div className="k">Best bets, past seasons</div><div className="v">{past.n ? pctTxt(past.rate) : '–'}</div><div className="r">{past.n ? `${past.w}-${past.l} on seasons the model never saw` : 'not tested for this sport'}</div></div>
        <div className="card"><div className="k">Best bets, this season</div><div className="v">{live.n ? `${live.w}-${live.l}${live.p ? `-${live.p}` : ''}` : 'Soon'}</div><div className="r">{live.n ? `${pctTxt(live.rate)} · ${uTxt(live.u)} units` : 'teams need four games played first'}</div></div>
      </div>
      {pr.n > 0 && pr.n < 60 && <p className="muted" style={{ margin: '-8px 0 18px', fontSize: 14 }}>{pr.n} best prices graded so far. That's too few to judge by wins and losses; beating the closing line is the early sign that matters.</p>}

      <section className="hsec">
        <h2>Best prices</h2>
        <p className="muted hsub" style={{ fontSize: 14 }}>A sportsbook paying more than a bet is worth. We take the odds at the sharpest books, remove their cut to get each side's fair chance, then check every other book's number and price against it. No prediction needed, just a book that's slow to move.</p>
        {!view.prices.length ? <div className="panel empty">No mispriced lines right now. We check the books every day around noon Central; these come and go quickly.</div> : <div className="betlist">{view.prices.map((b) => <BetCard key={b.id} b={b} />)}</div>}
      </section>

      <section className="hsec">
        <h2>Best bets coming up</h2>
        {!view.upcoming.length && <div className="panel empty">No best bets right now. We only flag a game when our number and the books are far enough apart to matter, so some days there are none.</div>}
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day} style={{ marginBottom: 14 }}>
            <h3 className="dayline">{day}</h3>
            <div className="betlist">{list.map((b) => <BetCard key={b.id} b={b} />)}</div>
          </div>
        ))}
      </section>

      <section className="hsec">
        <h2>Our number vs. the line</h2>
        <p className="muted hsub" style={{ fontSize: 14 }}>The games where our ratings and the sportsbooks disagree most. These aren't picks: over ten seasons, gaps like these were a coin flip against the spread. Use them as a second opinion.</p>
        {!view.gaps.length ? <div className="panel empty">No lines posted for upcoming games yet.</div> : <div className="betlist">{view.gaps.map((b) => <BetCard key={b.id} b={b} plain />)}</div>}
      </section>

      {view.graded.length > 0 && (
        <section className="hsec">
          <h2>Recent results</h2>
          <div className="panel" style={{ padding: 0 }}>
            <ul className="betresults">
              {view.graded.slice(0, 30).map((b) => (
                <li key={b.id}>
                  <Link to={`/${b.sport_id}/${b.season_year}/game/${b.game_id}`}>
                    <b className={b.result === 'win' ? 'W' : b.result === 'loss' ? 'L' : 'muted'}>{b.result === 'win' ? 'Won' : b.result === 'loss' ? 'Lost' : 'Push'}</b>
                    <span>{betText(b, b.home_name, b.away_name)} <span className="muted sm">{b.away_abbr} {b.away_score}, {b.home_abbr} {b.home_score}{b.kind === 'replay' ? ' · replayed' : ''}{isPrice(b) ? ` · best price at ${bookLabel(b.book)}` : ''}</span></span>
                    <span className="muted sm">{fmtDate(b.start_time)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="hsec" id="how">
        <h2>How this works</h2>
        <div className="panel">
          <p style={{ marginTop: 0 }}>Our number comes from the same ratings as the rest of the site. A game becomes a best bet only when our number and the sportsbooks' line are far enough apart that bets like it won money when we replayed past seasons week by week, using only what was known before each game. Right now that's women's basketball totals; we tested 40-odd other angles (rest, travel, altitude, letdown spots, line moves) across all three sports and nothing else held up, so nothing else is flagged.</p>
          <p>Best prices are a different idea: no prediction, just a price. When one book pays more on a side than the sharpest books say it's worth, that bet is expected to make money over time even though any single one can lose. That's the most reliable edge in sports betting, and the one professional bettors measure themselves against. We record every one before the game at the book and odds we saw, and grade it at those odds.</p>
          <p>Units assume one unit on each bet at the price posted when we flagged it. "Line moved our way" compares that price with where the line closed: the market agreeing with us after the fact is the best early sign a bet was a good one, win or lose.</p>
          <p className="muted sm" style={{ marginBottom: 0 }}>For information and entertainment. No betting system wins every week. If gambling stops being fun, call 1-800-GAMBLER or visit <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noreferrer">ncpgambling.org</a>.</p>
        </div>
      </section>
    </>
  );
}

function BetCard({ b, plain }: { b: Bet; plain?: boolean }) {
  const meta = sportMeta(b.sport_id);
  const homeSide = b.side === 'home' || b.side === 'over';
  const tier = b.tier && !plain ? TIER[b.tier] : null;
  return (
    <Link to={`/${b.sport_id}/${b.season_year}/game/${b.game_id}`} className="panel betcard">
      <div className="bc-top">
        <span className="pill">{meta.short}</span>
        <span className="muted sm">{fmtTime(b.start_time)}</span>
        {tier && <span className={tier.cls} style={{ marginLeft: 'auto' }}>{tier.label}</span>}
      </div>
      <div className="bc-main">
        {b.market !== 'total' && <img src={(homeSide ? b.home_logo : b.away_logo) ?? ''} alt="" width={36} height={36} />}
        <div>
          <div className="bc-pick">{betText(b, b.home_name, b.away_name)}</div>
          <div className="muted sm">{b.away_name} {b.neutral_site ? 'vs' : 'at'} {b.home_name}{b.book && !isPrice(b) ? ` · ${bookLabel(b.book)}` : ''}</div>
        </div>
      </div>
      <div className="sm" style={{ marginTop: 6 }}>
        {isPrice(b) ? <>{bookLabel(b.book)} pays <b>{oddsText(b.price)}</b> · fair odds {b.cover_prob != null ? oddsText(fairOdds(b.cover_prob)) : '–'} · about +{b.edge.toFixed(1)}% per bet</>
          : b.market === 'total' ? <>Our total {b.our_number.toFixed(1)} vs the books' {b.line}</>
          : <>Our number: {Math.abs(b.our_number) < 0.5 ? 'even' : `${b.our_number > 0 ? b.home_abbr : b.away_abbr} by ${Math.abs(b.our_number).toFixed(1)}`} · books: {b.side === 'home' ? `${b.home_abbr} ${sideNum(b.line)}` : `${b.away_abbr} ${sideNum(-b.line)}`}</>}
      </div>
      {b.reasons?.length > 0 && <div className="reasons">{b.reasons.filter((r) => !isPrice(b) || (r.key !== 'price' && r.key !== 'ev')).slice(0, 4).map((r) => <span key={r.key} className="chip static">{r.text}</span>)}</div>}
    </Link>
  );
}
