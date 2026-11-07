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
    restAll<any>(`v_bets?kind=eq.replay&result=not.is.null&order=start_time.asc`),
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
    const leans = live.filter((b) => soon(b) && b.tier === 'lean').sort((a, b) => b.edge - a.edge).slice(0, 12);
    const leanRec = [...replay.filter(cur), ...live.filter((b) => b.result)].filter((b) => b.tier === 'lean');
    // This season's best bets: replayed picks (what we'd have flagged, graded against the real line) plus live ones.
    const season = [...replay.filter(cur), ...live.filter((b) => b.result)].filter(isBest).sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    const allSeason = [...replay.filter(cur), ...live.filter((b) => b.result)];
    const past = replay.filter((b) => !cur(b) && isBest(b));
    const prices = priced.filter(soon).sort((a, b) => b.edge - a.edge).slice(0, 12);
    const priceRec = priced.filter((b) => b.result && b.result !== 'void');
    return { prices, priceRec, upcoming, leans, leanRec, season, allSpread: allSeason.filter((b) => b.market === 'spread'), allTotal: allSeason.filter((b) => b.market === 'total'), past, liveCount: live.filter((b) => b.result && isBest(b)).length };
  }, [data.data, sport]);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error} />;
  const pr = record(view.priceRec);
  const live = record(view.season), past = record(view.past), ats = record(view.allSpread), tot = record(view.allTotal);
  const sportsWithBets = new Set([...(data.data?.live ?? []), ...(data.data?.replay ?? [])].map((b) => b.sport_id));
  const byDay = new Map<string, Bet[]>();
  for (const b of view.upcoming) { const d = fmtDate(b.start_time, { weekday: 'long', month: 'short', day: 'numeric' }); byDay.set(d, [...(byDay.get(d) ?? []), b]); }

  return (
    <>
      <Back />
      <h1>Best bets</h1>
      <p className="sub">Games where our number and the sportsbooks disagree enough to matter, and why. Each one is locked in before the game and graded after, good or bad.</p>
      <div className="chips">
        <button className={`chip ${sport === 'all' ? 'on' : ''}`} onClick={() => setSport('all')}>All sports</button>
        {Object.values(SPORTS).filter((s) => sportsWithBets.has(s.id)).map((s) => <button key={s.id} className={`chip ${sport === s.id ? 'on' : ''}`} onClick={() => setSport(s.id)}>{s.short}</button>)}
      </div>

      <div className="cards" style={{ marginBottom: 18 }}>
        <div className="card"><div className="k">Best bets this season</div><div className="v">{live.n ? `${live.w}-${live.l}${live.p ? `-${live.p}` : ''}` : '0-0'}</div><div className="r">{live.n ? `${pctTxt(live.rate)} · ${uTxt(live.u)} units` : 'none yet'}</div></div>
        <div className="card"><div className="k">Line moved our way</div><div className="v">{live.clv != null ? `${live.clv >= 0 ? '+' : '\u2212'}${Math.abs(live.clv).toFixed(1)}` : '–'}</div><div className="r">points, on average</div></div>
        <div className="card"><div className="k">Every game, against the spread</div><div className="v">{ats.n ? pctTxt(ats.rate) : '–'}</div><div className="r">{ats.n ? `${ats.w}-${ats.l} this season` : 'no lines yet'}</div></div>
        <div className="card"><div className="k">Every game, totals</div><div className="v">{tot.n ? pctTxt(tot.rate) : '–'}</div><div className="r">{tot.n ? `${tot.w}-${tot.l} this season` : 'no lines yet'}</div></div>
        <div className="card"><div className="k">Best prices</div><div className="v">{pr.n ? `${uTxt(pr.u)}` : '–'}</div><div className="r">{pr.n ? `units · ${pr.w}-${pr.l}${pr.p ? `-${pr.p}` : ''}` : 'tracking starts today'}</div></div>
      </div>
      <p className="muted sm" style={{ margin: '-8px 0 18px' }}>This season's record includes games played before the site went live, scored with the pick our model would have made before each game, against the real opening line.{view.liveCount ? ` ${view.liveCount} were flagged live.` : ''}{past.n ? ` Same rules on earlier seasons the model never saw: ${past.w}-${past.l} (${pctTxt(past.rate)}).` : ''}</p>

      <section className="hsec">
        <h2>Coming up</h2>
        {!view.upcoming.length && <div className="panel empty">No best bets right now. We only flag a game when our number and the books are far enough apart to matter, so some days there are none.</div>}
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day} style={{ marginBottom: 14 }}>
            <h3 className="dayline">{day}</h3>
            <div className="betlist">{list.map((b) => <BetCard key={b.id} b={b} />)}</div>
          </div>
        ))}
      </section>

      <section className="hsec">
        <h2>Best prices</h2>
        <p className="muted sm hsub">A sportsbook paying more than a bet is worth. We take the odds at the sharpest books (the ones pros bet into), remove their cut to get each side's fair chance, then check every other book's number and price against it. These don't need our model to be right, just a book that's slow to move. Our model's view is shown when it has one.</p>
        {!view.prices.length ? <div className="panel empty">No mispriced lines right now. We check the books every day around noon Central; these come and go quickly.</div> : <div className="betlist">{view.prices.map((b) => <BetCard key={b.id} b={b} />)}</div>}
      </section>

      <section className="hsec">
        <h2>Leans</h2>
        <p className="muted sm hsub">Not a tested edge: the games where our number and the books disagree most, so there's always something on the board. Graded like everything else{(() => { const r = record(view.leanRec); return r.n ? `: ${r.w}-${r.l} (${pctTxt(r.rate)}) this season` : ''; })()}.</p>
        {!view.leans.length ? <div className="panel empty">No lines posted for upcoming games yet.</div> : <div className="betlist">{view.leans.map((b) => <BetCard key={b.id} b={b} />)}</div>}
      </section>

      {view.season.length > 0 && (
        <section className="hsec">
          <h2>Recent results</h2>
          <div className="panel" style={{ padding: 0 }}>
            <ul className="betresults">
              {view.season.slice(0, 30).map((b) => (
                <li key={b.id}>
                  <Link to={`/${b.sport_id}/${b.season_year}/game/${b.game_id}`}>
                    <b className={b.result === 'win' ? 'W' : b.result === 'loss' ? 'L' : 'muted'}>{b.result === 'win' ? 'Won' : b.result === 'loss' ? 'Lost' : 'Push'}</b>
                    <span>{betText(b, b.home_name, b.away_name)} <span className="muted sm">{b.away_abbr} {b.away_score}, {b.home_abbr} {b.home_score}{b.kind === 'replay' ? ' · replayed' : ''}</span></span>
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

function BetCard({ b }: { b: Bet }) {
  const meta = sportMeta(b.sport_id);
  const homeSide = b.side === 'home' || b.side === 'over';
  const tier = b.tier ? TIER[b.tier] : null;
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
