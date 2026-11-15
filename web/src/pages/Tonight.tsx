import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFollows, fmtTime } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { TeamPicker } from '../components/TeamPicker';
import { SPORTS } from '../sports';
import { pct } from '../model';
import { usePlayoff, init, tonight } from '../playoff/store';
import { useBracket, initBracket, tonightB } from '../bracket/store';
import { Logo } from './Playoff';

// One shape for both simulators: the teams, the games still to play, and what each game does to the teams you follow.
interface Team { id: number; name: string; logo: string | null }
interface Row { key: string; date: number; h: number; a: number; p: number; live?: { hs: number; as: number; detail: string; p0: number } }
interface Impact { make: number[]; games: number[]; d: number[] }
const SPORT_IDS = ['cfb', 'mbb', 'wbb'] as const;
const FIELD: Record<string, string> = { cfb: 'the playoff', mbb: 'the tournament', wbb: 'the tournament' };

// "Tonight" runs to 6 the next morning. If nothing is left tonight, show the next day that has games.
function slate(rows: Row[], now: number): { rows: Row[]; label: string } {
  const end = new Date(now); if (end.getHours() >= 6) end.setDate(end.getDate() + 1); end.setHours(6, 0, 0, 0);
  const on = rows.filter((g) => (g.live || g.date > now - 4.5 * 3600e3) && g.date < +end);
  if (on.length) return { rows: on, label: '' };
  const next = rows.filter((g) => g.date > now).sort((x, y) => x.date - y.date)[0]; if (!next) return { rows: [], label: '' };
  const s = new Date(next.date); if (s.getHours() < 6) s.setDate(s.getDate() - 1); s.setHours(6, 0, 0, 0); const e = +s + 864e5;
  return { rows: rows.filter((g) => g.date >= +s && g.date < e), label: new Date(next.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) };
}

export function TonightPage() {
  const { list } = useFollows(); const [picker, setPicker] = useState(false);
  const mineIn = (sp: string) => list.filter((f) => f.sport === sp);
  const [sport, setSport] = useState<string>(() => { const m = new Date().getMonth() + 1; const order = m >= 8 && m <= 12 ? ['cfb', 'mbb', 'wbb'] : ['mbb', 'wbb', 'cfb']; return order.find((sp) => list.some((f) => f.sport === sp)) ?? order[0]; });
  const year = SPORTS[sport].seasons[0].year, base = `/${sport}/${year}`;
  const fb = usePlayoff(), hp = useBracket();
  useEffect(() => { if (sport === 'cfb') init(year); else initBracket(sport, year); }, [sport, year]);

  const ready = sport === 'cfb' ? fb.status === 'ready' && !!fb.pack : hp.status === 'ready' && hp.sport === sport && !!hp.pack;
  const error = sport === 'cfb' ? (fb.status === 'error' ? fb.error : null) : hp.status === 'error' ? hp.error : null;
  const teams: Team[] = useMemo(() => (!ready ? [] : (sport === 'cfb' ? fb.pack!.teams : hp.pack!.teams).map((t) => ({ id: t.id, name: t.name, logo: t.logo }))), [ready, sport, fb.pack, hp.pack]);
  const rows: Row[] = useMemo(() => (!ready ? [] : sport === 'cfb' ? fb.pack!.games.map((g) => ({ key: g.key, date: g.date, h: g.h, a: g.a, p: g.p, live: g.live })) : hp.pack!.games.map((g) => ({ key: g.key, date: g.date, h: g.h, a: g.a, p: g.p }))), [ready, sport, fb.pack, hp.pack]);
  const lev0 = sport === 'cfb' ? fb.base?.lev : hp.base?.lev;
  const follows = mineIn(sport);
  const focus = useMemo(() => follows.map((f) => teams.findIndex((t) => t.id === f.team_id)).filter((i) => i >= 0).slice(0, 8), [follows.map((f) => f.team_id).join(','), teams]);

  const [imp, setImp] = useState<Impact | null>(null);
  useEffect(() => { setImp(null); if (!ready || !focus.length) return; let live = true; (sport === 'cfb' ? tonight(focus) : tonightB(focus)).then((r) => live && setImp(r)); return () => { live = false; }; }, [ready, sport, focus.join(','), fb.pack, hp.pack]);

  const now = Date.now(); const sl = useMemo(() => slate(rows, now), [rows]);
  const onSlate = new Set(sl.rows.map((g) => g.key));
  const name = (i: number) => (i >= 0 ? teams[i].name : sport === 'cfb' ? 'an FCS opponent' : 'a lower-division opponent');
  const when = (g: Row) => (g.live ? <span className="tn-live">{g.live.detail}</span> : <span className="muted">{fmtTime(new Date(g.date).toISOString())}</span>);
  const field = FIELD[sport];
  // Games that move the whole race, for the list at the bottom: total swing across the teams still in doubt.
  const weight = useMemo(() => { const m = new Map<string, number>(); if (lev0 && ready) lev0.games.forEach((gi, k) => { const g = rows[gi]; if (g) m.set(g.key, lev0.impact[k]); }); return m; }, [lev0, rows, ready]);

  return (
    <>
      <Back />
      <h1>Tonight's games</h1>
      <p className="sub">{sl.label ? `Nothing left tonight. Next up: ${sl.label}.` : 'Every game on tonight, and what each one means for your teams.'}</p>
      <div className="chips" style={{ marginBottom: 14 }}>
        {SPORT_IDS.map((sp) => <button key={sp} className={`chip ${sport === sp ? 'on' : ''}`} onClick={() => setSport(sp)}>{SPORTS[sp].short}</button>)}
      </div>
      {error ? <ErrorBox msg={error} /> : !ready ? <Loading /> : (
        <>
          {!focus.length && (
            <div className="panel tn-empty">
              <b>Pick your team</b>
              <p className="muted">Follow a {SPORTS[sport].short.toLowerCase()} team and this page shows what every game tonight does to their chance to make {field}.</p>
              <button className="btn" onClick={() => setPicker(true)}>Choose teams</button>
            </div>
          )}
          {focus.map((ti, k) => {
            const t = teams[ti], make = imp?.make[k];
            const all = imp ? imp.games.map((gi, n) => ({ g: rows[gi], d: imp.d[n * focus.length + k] })).filter((x) => x.g && onSlate.has(x.g.key)) : [];
            const own = sl.rows.find((g) => g.h === ti || g.a === ti), ownD = all.find((x) => x.g.key === own?.key);
            const others = all.filter((x) => x.g.key !== own?.key && Math.abs(x.d) >= 0.01).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 6);
            // From the average and the gap between the two outcomes, the chance after a win and after a loss.
            let win: number | null = null, lose: number | null = null;
            if (own && ownD && make != null && ownD.d !== 0) { const hw = make + (1 - own.p) * ownD.d, aw = make - own.p * ownD.d; [win, lose] = own.h === ti ? [hw, aw] : [aw, hw]; }
            return (
              <section key={t.id} className="panel tn-team">
                <Link to={`${base}/${sport === 'cfb' ? 'playoff' : 'tournament'}/${t.id}`} className="tn-head">
                  <Logo src={t.logo} size={44} /><span><b>{t.name}</b><span className="muted sm">Chance to make {field}</span></span>
                  <span className="num">{make == null ? '…' : pct(make)}</span>
                </Link>
                {own && (
                  <Link to={`${base}/game/${own.key}`} className="tn-own">
                    <span><b>{own.h === ti ? `vs ${name(own.a)}` : `at ${name(own.h)}`}</b> · {when(own)}{own.live && <> · {own.h === ti ? `${own.live.hs}-${own.live.as}` : `${own.live.as}-${own.live.hs}`}</>}
                      <span className="muted sm" style={{ display: 'block' }}>{pct(own.h === ti ? own.p : 1 - own.p)} to win{own.live ? ' right now' : ''}</span></span>
                    {win != null && lose != null && Math.abs(win - lose) >= 0.01 && <span className="tn-wl"><span>Win <b className="up">{pct(Math.min(1, Math.max(0, win)))}</b></span><span>Lose <b className="dn">{pct(Math.min(1, Math.max(0, lose)))}</b></span></span>}
                  </Link>
                )}
                {!imp ? <p className="muted tn-note">Working out what tonight means…</p> : others.length ? (
                  <>
                    <div className="tn-k">What helps {t.name}{own ? ' elsewhere' : ''}</div>
                    <ul className="tn-list">{others.map(({ g, d }) => { const w = d > 0 ? g.h : g.a, l = d > 0 ? g.a : g.h; const sofar = g.live ? d * (g.p - g.live.p0) : 0;
                      return (
                        <li key={g.key}><Link to={`${base}/game/${g.key}`}>
                          <span><b>{name(w)}</b> beats {name(l)}<span className="sm" style={{ display: 'block' }}>{when(g)}{g.live && <> · {name(g.a)} {g.live.as}, {name(g.h)} {g.live.hs}</>}{Math.abs(sofar) >= 0.005 && <b className={sofar > 0 ? 'up' : 'dn'}> · {sofar > 0 ? '▲' : '▼'}{Math.max(1, Math.abs(Math.round(sofar * 100)))} so far</b>}</span></span>
                          <b className="up tn-d">+{Math.max(1, Math.round(Math.abs(d) * 100))}</b>
                        </Link></li>
                      ); })}</ul>
                  </>
                ) : <p className="muted tn-note">{make != null && make > 0.99 ? `${t.name} is in from almost anywhere. Nothing ${own ? 'else ' : ''}tonight changes that.` : make != null && make < 0.005 ? `${t.name} is out of the picture, and nothing tonight changes that.` : sport === 'cfb' ? `Nothing ${own ? 'else ' : ''}on tonight moves their chances by a full point.` : `Nothing ${own ? 'else ' : ''}on tonight moves their chances by a full point. This early in the season, single games rarely do.`}</p>}
              </section>
            ); })}
          {focus.length > 0 && <p className="muted sm" style={{ margin: '0 2px 16px' }}>The green number is how many points a result adds to that team's chance to make {field}. <button className="linkish" onClick={() => setPicker(true)}>Change teams</button></p>}

          <h2>{sl.label ? `Games on ${sl.label}` : 'Every game tonight'}</h2>
          {sl.rows.length === 0 ? <div className="panel empty"><p>No games on the schedule.</p></div> : (
            <ul className="tn-list panel" style={{ padding: '4px 14px' }}>{[...sl.rows].filter((g) => g.h >= 0 || g.a >= 0).sort((x, y) => (weight.get(y.key) ?? 0) - (weight.get(x.key) ?? 0) || x.date - y.date).slice(0, 60).map((g) => { const big = (weight.get(g.key) ?? 0) >= 0.15; const fav = g.p >= 0.5 ? g.h : g.a;
              return (
                <li key={g.key}><Link to={`${base}/game/${g.key}`}>
                  <span><b>{name(g.a)}</b> at <b>{name(g.h)}</b>{big && <span className="tn-tag">Moves the race</span>}<span className="sm" style={{ display: 'block' }}>{when(g)}{g.live && <> · {g.live.as}-{g.live.hs}</>}</span></span>
                  <span className="tn-fav">{name(fav)}<b>{pct(Math.max(g.p, 1 - g.p))}</b></span>
                </Link></li>
              ); })}</ul>
          )}
        </>
      )}
      {picker && <TeamPicker onClose={() => setPicker(false)} />}
    </>
  );
}
