import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { restAll, toBet, type Bet } from '../api';
import { useAsync, fmtDate, fmtTime } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { betText, TIER, bookLabel, sideNum } from '../components/Lines';
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
    restAll<any>(`v_bets?kind=eq.replay&result=not.is.null&select=sport_id,season_year,market,tier,result,price,clv,start_time&order=start_time.asc`),
  ]).then(([live, rep]) => ({ live: live.map(toBet), replay: rep.map((b: any) => ({ ...b, clv: b.clv == null ? null : Number(b.clv) })) as Bet[] })), []);

  const view = useMemo(() => {
    const live = (data.data?.live ?? []).filter((b) => sport === 'all' || b.sport_id === sport);
    const replay = (data.data?.replay ?? []).filter((b) => sport === 'all' || b.sport_id === sport);
    const now = Date.now();
    const upcoming = live.filter((b) => !b.completed && new Date(b.start_time).getTime() > now - 3 * 3600e3 && b.tier !== 'lean');
    const graded = live.filter((b) => b.result).sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    const called = graded.filter((b) => b.tier !== 'lean');
    return { upcoming, graded, called, replay: replay.filter((b) => b.tier !== 'lean') };
  }, [data.data, sport]);

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error} />;
  const live = record(view.called), past = record(view.replay);
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
        <div className="card"><div className="k">This season</div><div className="v">{live.n ? `${live.w}-${live.l}${live.p ? `-${live.p}` : ''}` : '0-0'}</div><div className="r">{live.n ? pctTxt(live.rate) : 'no results yet'}</div></div>
        <div className="card"><div className="k">Units</div><div className="v" style={{ color: live.u > 0 ? 'var(--win)' : live.u < 0 ? 'var(--hot)' : undefined }}>{live.n ? uTxt(live.u) : '–'}</div><div className="r">one unit per bet</div></div>
        <div className="card"><div className="k">Line moved our way</div><div className="v">{live.clv != null ? `${live.clv >= 0 ? '+' : '−'}${Math.abs(live.clv).toFixed(1)}` : '–'}</div><div className="r">points, on average</div></div>
        <div className="card"><div className="k">Same rules, past seasons</div><div className="v">{past.n ? pctTxt(past.rate) : '–'}</div><div className="r">{past.n ? `${past.w}-${past.l} replayed` : 'not run yet'}</div></div>
      </div>

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

      {view.graded.length > 0 && (
        <section className="hsec">
          <h2>Recent results</h2>
          <div className="panel" style={{ padding: 0 }}>
            <ul className="betresults">
              {view.graded.slice(0, 30).map((b) => (
                <li key={b.id}>
                  <Link to={`/${b.sport_id}/${b.season_year}/game/${b.game_id}`}>
                    <b className={b.result === 'win' ? 'W' : b.result === 'loss' ? 'L' : 'muted'}>{b.result === 'win' ? 'Won' : b.result === 'loss' ? 'Lost' : 'Push'}</b>
                    <span>{betText(b, b.home_name, b.away_name)} <span className="muted sm">{b.away_abbr} {b.away_score}, {b.home_abbr} {b.home_score}{b.tier === 'lean' ? ' · lean' : ''}</span></span>
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
          <p style={{ marginTop: 0 }}>Our number comes from the same ratings as the rest of the site. A game becomes a bet only when our number and the sportsbooks' line are far enough apart, and the extra factors we've tested (rest, travel, altitude and others) agree. The tier is how often bets like it won when we replayed past seasons week by week, using only what was known before each game.</p>
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
          <div className="muted sm">{b.away_name} {b.neutral_site ? 'vs' : 'at'} {b.home_name}{b.book ? ` · ${bookLabel(b.book)}` : ''}</div>
        </div>
      </div>
      <div className="sm" style={{ marginTop: 6 }}>
        {b.market === 'total' ? <>Our total {b.our_number.toFixed(1)} vs the books' {b.line}</>
          : <>Our number: {Math.abs(b.our_number) < 0.5 ? 'even' : `${b.our_number > 0 ? b.home_abbr : b.away_abbr} by ${Math.abs(b.our_number).toFixed(1)}`} · books: {b.side === 'home' ? `${b.home_abbr} ${sideNum(b.line)}` : `${b.away_abbr} ${sideNum(-b.line)}`}</>}
      </div>
      {b.reasons?.length > 0 && <div className="reasons">{b.reasons.slice(0, 4).map((r) => <span key={r.key} className="chip static">{r.text}</span>)}</div>}
    </Link>
  );
}
