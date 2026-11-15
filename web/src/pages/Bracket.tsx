import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCtx } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { pct } from '../model';
import { Pct, Logo, useFlip } from './Playoff';
import { useBracket, initBracket, pickB, setLocksB, resetB, clearRippleB, linePaths, type BState } from '../bracket/store';
import type { BPack, BGame, BResult } from '../bracket/sim';
import type { LinePath } from '../bracket/worker';
import { ShareButton } from '../components/ShareCard';

type Metric = 'make' | 'top4' | 'f4' | 'champ';
const METRICS: { id: Metric; label: string }[] = [{ id: 'make', label: 'Make the field' }, { id: 'top4', label: 'Top-4 seed' }, { id: 'f4', label: 'Final Four' }, { id: 'champ', label: 'Win it all' }];
const top4 = (r: BResult, i: number) => r.lines[i * 18 + 1] + r.lines[i * 18 + 2] + r.lines[i * 18 + 3] + r.lines[i * 18 + 4];
const val = (r: BResult, m: Metric, i: number) => (m === 'make' ? r.make[i] : m === 'top4' ? top4(r, i) : m === 'f4' ? r.reach[4][i] : r.reach[6][i]);
const modeLine = (r: BResult, i: number) => { let b = 0, v = 0; for (let k = 1; k <= 16; k++) if (r.lines[i * 18 + k] > v) { v = r.lines[i * 18 + k]; b = k; } return b; };
const delta = (d: number) => (Math.abs(d) < 0.01 ? null : <span className={`po-delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d * 100))}</span>);
const pickText = (p: BPack, g: BGame, win: number) => { const lose = g.h === win ? g.a : g.h; return `${p.teams[win].name} beats ${lose >= 0 ? p.teams[lose].name : 'a lower-division opponent'}`; };
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function useData() { const { sport, season } = useCtx(); const s = useBracket(); useEffect(() => { initBracket(sport, season); }, [sport, season]); return s; }
const early = (p: BPack) => p.teams.reduce((a, t) => a + t.w + t.l, 0) / p.teams.length < 10;

function Row({ s, i, n, v, d, base, sub }: { s: BState; i: number; n?: number; v: number; d: number; base: string; sub?: string }) {
  const t = s.pack!.teams[i];
  return (
    <Link to={`${base}/tournament/${t.id}`} className="po-row">
      <span className="po-n">{n ?? ''}</span><Logo src={t.logo} size={34} />
      <span className="po-name"><b>{t.name}</b><span className="muted">{sub ?? `${t.w}-${t.l} · ${s.pack!.confs[t.conf]?.name ?? 'Independent'}`}</span></span>
      <span className="po-val">{delta(d)}<Pct v={v} className="po-pct" /></span>
      <span className="po-bar"><i style={{ width: `${Math.max(1.5, v * 100)}%`, background: v >= 0.75 ? 'var(--win)' : v >= 0.25 ? 'var(--gold)' : 'var(--muted)' }} /></span>
    </Link>
  );
}

function Board({ s, base }: { s: BState; base: string }) {
  const p = s.pack!, cur = s.cur ?? s.base!, b0 = s.base!; const [metric, setMetric] = useState<Metric>('make'); const [all, setAll] = useState(false);
  const changed = Object.keys(s.locks).length > 0;
  const order = useMemo(() => p.teams.map((_, i) => i).sort((a, b) => val(cur, metric, b) - val(cur, metric, a) || cur.make[b] - cur.make[a] || p.teams[a].ourRank - p.teams[b].ourRank), [cur, metric, p]);
  const shown = order.slice(0, all ? 200 : metric === 'make' ? 90 : 40).filter((i) => val(cur, metric, i) >= 0.005 || all);
  const flip = useFlip(shown.join(','));
  return (
    <div>
      <div className="chips scroll">{METRICS.map((m) => <button key={m.id} className={`chip ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>{m.label}</button>)}</div>
      <div className="po-board" style={{ opacity: s.busy ? 0.75 : 1 }}>
        {shown.map((i, n) => <div key={p.teams[i].id} ref={flip(p.teams[i].id)}>
          {n === p.format.size && metric === 'make' && <div className="po-cut"><span>The field is {p.format.size}</span></div>}
          <Row s={s} i={i} n={n + 1} v={val(cur, metric, i)} d={changed ? val(cur, metric, i) - val(b0, metric, i) : 0} base={base} sub={`${p.teams[i].w}-${p.teams[i].l} · ${modeLine(cur, i) ? `most often a ${modeLine(cur, i)} seed` : p.confs[p.teams[i].conf]?.name ?? ''}`} />
        </div>)}
      </div>
      <button className="po-more" onClick={() => setAll(!all)}>{all ? 'Show fewer teams' : 'Show more teams'}</button>
    </div>
  );
}

function Bubble({ s, base }: { s: BState; base: string }) {
  const p = s.pack!, cur = s.cur ?? s.base!, b0 = s.base!; const changed = Object.keys(s.locks).length > 0;
  // At-large chances only: a team that's in only by winning its league isn't on the bubble.
  const atl = (i: number) => Math.max(0, cur.make[i] - cur.auto[i]);
  const ids = p.teams.map((_, i) => i).filter((i) => cur.make[i] > 0.2 && cur.make[i] < 0.85 && atl(i) > 0.1).sort((a, b) => cur.make[b] - cur.make[a]);
  const inNow = ids.filter((i) => cur.make[i] >= 0.5).slice(-12), out = ids.filter((i) => cur.make[i] < 0.5).slice(0, 12);
  const list = (title: string, note: string, xs: number[]) => (<section className="po-week"><h3>{title}</h3><p className="muted po-hint">{note}</p><div className="po-board">{xs.map((i) => <Row key={i} s={s} i={i} v={cur.make[i]} d={changed ? cur.make[i] - b0.make[i] : 0} base={base} />)}</div></section>);
  return <div>{list('Last teams in', 'In more often than not, but one bad week changes that.', inNow)}{list('First teams out', 'On the wrong side of the line right now.', out)}</div>;
}

function Tonight({ s }: { s: BState }) {
  const p = s.pack!, cur = s.cur ?? s.base!, lv = s.base!.lev;
  const rows = useMemo(() => { if (!lv) return []; return lv.games.map((gi, k) => { let best = -1, bd = 0; for (let ti = 0; ti < lv.teams.length; ti++) { const d = Math.abs(lv.d[k * lv.teams.length + ti]); if (d > bd) { bd = d; best = lv.teams[ti]; } } return { g: p.games[gi], impact: lv.impact[k], best, bd }; }).filter((x) => x.impact > 0 || x.g.key in s.locks).sort((a, b) => b.impact - a.impact).slice(0, 24); }, [lv, p, s.locks]);
  if (!rows.length) return <div className="panel empty">No game in the next three days moves the tournament picture much. That changes fast once conference play starts.</div>;
  const side = (g: BGame, idx: number, pw: number) => { if (idx < 0) return <span className="po-side off"><span className="po-side-n">Lower-division opponent</span></span>; const t = p.teams[idx], on = s.locks[g.key] === idx, off = s.locks[g.key] != null && !on;
    return <button className={`po-side ${on ? 'on' : ''} ${off ? 'dim' : ''}`} onClick={() => pickB(g.key, idx, pickText(p, g, idx))} aria-pressed={on}><Logo src={t.logo} size={30} /><span className="po-side-n">{t.name}</span><span className="num">{on ? 'Wins' : pct(pw)}</span></button>; };
  return (
    <div>
      <p className="muted po-hint">The games over the next three days that move the most teams' chances. Tap a winner to see what it does.</p>
      {rows.map(({ g, best }) => (
        <div key={g.key} className="po-game">
          <div className="po-game-top"><span>{day(g.date)}</span>{best >= 0 && <span>Means most to {p.teams[best].name}</span>}</div>
          <div className="po-sides">{side(g, g.a, 1 - g.p)}<span className="po-at">{g.neutral ? 'vs' : 'at'}</span>{side(g, g.h, g.p)}</div>
        </div>
      ))}
    </div>
  );
}

function Toast({ s }: { s: BState }) {
  const r = s.ripple; useEffect(() => { if (!r) return; const t = setTimeout(clearRippleB, 6500); return () => clearTimeout(t); }, [r?.at]);
  if (!r || !s.pack) return null;
  return <div className="po-toast" role="status" onClick={clearRippleB}><b>{r.title}</b>{r.moves.map((m) => <div key={m.team} className="po-toast-row"><span>{s.pack!.teams[m.team].name}</span><span className="num">{pct(m.from)} → <b className={m.to > m.from ? 'up' : 'dn'}>{pct(m.to)}</b></span></div>)}</div>;
}
const Scenario = ({ s }: { s: BState }) => { const n = Object.keys(s.locks).length; return n ? <div className="po-scn"><span><b>Your scenario</b> · {n} {n === 1 ? 'pick' : 'picks'}</span><span className="po-scn-b"><button onClick={resetB}>Reset</button></span></div> : null; };

export function BracketPage() {
  const { base, meta } = useCtx(); const s = useData(); const [tab, setTab] = useState<'board' | 'bubble' | 'tonight'>('board');
  if (s.status === 'error') return <><Back /><ErrorBox msg={s.error ?? ''} /></>;
  if (s.status !== 'ready' || !s.pack || !s.base) return <><Back /><h1>Tournament picture</h1><p className="sub">Playing out the rest of the season 2,500 times…</p><Loading rows={10} /></>;
  const p = s.pack;
  return (
    <div className="po">
      <Back />
      <h1>Tournament picture</h1>
      <p className="sub" style={{ marginBottom: 14 }}>Each {meta.short.toLowerCase().replace("'s hoops", "'s")} team's chance to make the {p.format.size}-team NCAA tournament, and how far it goes.{early(p) ? " It's early in the season, so expect these to move a lot." : ''}</p>
      <Scenario s={s} />
      <div className="po-tabs" role="tablist">{([['board', 'The board'], ['bubble', 'Bubble'], ['tonight', 'Games that matter']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'board' ? <Board s={s} base={base} /> : tab === 'bubble' ? <Bubble s={s} base={base} /> : <Tonight s={s} />}
      <details className="panel po-how">
        <summary>How this works</summary>
        <p>We play every remaining game 2,500 times using our win chances, then every conference tournament, then fill the field the way the committee does: each conference's champion, plus the best remaining résumés. A résumé here means how many more games a team has won than a typical bubble team would have against the same schedule. Over the last four tournaments, that measure correctly placed 98% of the men's teams and every women's team it had safely in the field.</p>
        <p>The 2027 tournaments have 76 teams, with a 12-game opening round ahead of the bracket of 64. Until the NCAA publishes the full format, we pair the last twelve at-large teams and the twelve lowest-ranked champions. Seed lines and conference tournaments are estimates.</p>
      </details>
      <Toast s={s} />
    </div>
  );
}

function Strip({ dist }: { dist: number[] }) {
  const top = Math.max(0.0001, ...dist); const cell = (v: number, label: string, cls: string, key: string) => <span key={key} className={cls} style={{ ['--a' as any]: v < 0.01 ? 0 : 0.15 + 0.85 * (v / top), color: v / top > 0.5 ? '#fff' : v >= 0.01 ? 'var(--ink)' : undefined }}>{label}</span>;
  return <div className="po-strip s16" aria-hidden>{Array.from({ length: 16 }, (_, k) => cell(dist[k + 1], String(k + 1), k < 4 ? 'bye' : '', String(k)))}{cell(dist[0], 'Out', 'out', 'o')}</div>;
}

export function BracketTeamPage() {
  const { base } = useCtx(); const { teamId } = useParams(); const s = useData();
  const p = s.pack, cur = s.cur ?? s.base; const ti = p ? p.teams.findIndex((t) => t.id === Number(teamId)) : -1;
  const [lp, setLp] = useState<{ games: string[]; rows: LinePath[] } | null>(null); const lockKey = JSON.stringify(s.locks);
  useEffect(() => { if (ti < 0 || s.status !== 'ready') return; let live = true; setLp(null); linePaths(ti).then((r) => live && setLp(r)); return () => { live = false; }; }, [ti, lockKey, s.status]);
  const path = useMemo(() => { const lv = s.base?.lev; if (!p || !lv || ti < 0) return []; const k = lv.teams.indexOf(ti); if (k < 0) return []; return lv.games.map((gi, n) => ({ g: p.games[gi], d: lv.d[n * lv.teams.length + k] })).filter((x) => Math.abs(x.d) >= 0.03 && x.g.h >= 0 && x.g.a >= 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6); }, [p, s.base, ti]);
  if (s.status === 'error') return <><Back /><ErrorBox msg={s.error ?? ''} /></>;
  if (s.status !== 'ready' || !p || !cur) return <><Back /><Loading rows={10} /></>;
  if (ti < 0) return <><Back /><div className="panel empty">That team isn't in this season's picture.</div></>;
  const t = p.teams[ti], b0 = s.base!, make = cur.make[ti], d = Object.keys(s.locks).length ? make - b0.make[ti] : 0, line = modeLine(cur, ti), F = p.format;
  const stages: [string, number, string?][] = [['Top-4 seed', top4(cur, ti)], ['In as a conference champion', cur.auto[ti], 'automatic bid'], ['In as an at-large', Math.max(0, make - cur.auto[ti]), "the committee's pick"], ['Lose in the opening round', cur.lines[ti * 18 + 17], 'the 12 games before the bracket of 64'],
    ...F.rounds.slice(1).map((name, r) => [r === F.rounds.length - 2 ? name : `Reach the ${name}`, cur.reach[r + 1][ti]] as [string, number])];
  const mine = p.games.filter((g) => g.h === ti || g.a === ti).slice(0, 6);
  return (
    <div className="po">
      <Back />
      <div className="po-thead"><Logo src={t.logo} size={64} /><div><h1 style={{ marginBottom: 2 }}>{t.name}</h1><div className="muted">{t.w}-{t.l}{t.conf >= 0 ? ` · ${p.confs[t.conf].name}` : ''} · projected {Math.round(cur.expW[ti])}-{Math.round(cur.expL[ti])} before the tournament</div></div></div>
      <Scenario s={s} />
      <div className="po-hero">
        <div className="k">Make the tournament</div>
        <div className="v"><Pct v={make} />{Math.abs(d) >= 0.01 ? <span className={`po-delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d * 100))}</span> : null}</div>
        <div className="muted">{line ? `Most often a No. ${line} seed` : 'Outside the bracket in every simulation'} · our power rating #{t.ourRank}</div>
        <div style={{ marginTop: 10 }}><Strip dist={Array.from({ length: 18 }, (_, k) => (k === 0 ? cur.lines[ti * 18] + (1 - cur.make[ti]) + cur.lines[ti * 18 + 17] : cur.lines[ti * 18 + k]))} /></div>
        <div style={{ marginTop: 12 }}><ShareButton card={{ kind: 'team', title: t.name, logo: t.logo, sub: `${t.w}-${t.l}${t.conf >= 0 ? ` · ${p.confs[t.conf].name}` : ''}`, big: pct(make), bigLabel: 'to make the NCAA tournament', lines: [line ? `Most often a No. ${line} seed` : 'Outside the bracket for now', `Final Four ${pct(cur.reach[4][ti])} · Win it all ${pct(cur.reach[6][ti])}`] }} /></div>
      </div>

      <section className="hsec">
        <h2>Seed paths</h2>
        <p className="muted hsub">Where {t.name} lands for each way their next games can go. Darker boxes are likelier seeds. Tap a path to play it.</p>
        {!lp ? <Loading rows={3} /> : !lp.games.length ? <div className="panel empty">No games left on the schedule.</div> : (
          <div className="po-paths">{lp.rows.map((r, i) => {
            const title = r.wins.map((w, k) => { const g = p.games.find((x) => x.key === r.keys[k])!; const opp = g.h === ti ? g.a : g.h; return `${w ? 'Beat' : 'Lose to'} ${opp >= 0 ? p.teams[opp].name : 'a lower-division team'}`; }).join(', then ').replace(/, then (Beat|Lose)/g, (_, v) => `, then ${v.toLowerCase()}`);
            const apply = () => { const locks = { ...s.locks }; r.keys.forEach((k, n) => { const g = p.games.find((x) => x.key === k)!; const opp = g.h === ti ? g.a : g.h; if (r.wins[n]) locks[k] = ti; else if (opp >= 0) locks[k] = opp; }); setLocksB(locks, title); };
            return (<div key={i} className="po-pathrow tap" role="button" onClick={apply}>
              <div className="po-path-head"><span><b>{title}</b><span className="muted sm" style={{ display: 'block' }}>Happens {pct(r.p)} of the time</span></span><span className="po-path-seed">{r.make < 0.35 ? <>Likely out<span className="muted sm" style={{ display: 'block' }}>{pct(r.make)} in</span></> : <>No. {r.mode}<span className="muted sm" style={{ display: 'block' }}>{pct(r.make)} in</span></>}</span></div>
              <Strip dist={r.dist.map((v, k) => (k === 0 ? v + r.dist[17] : v))} />
            </div>);
          })}</div>)}
      </section>

      <section className="hsec">
        <h2>How far they go</h2>
        <div className="po-stages">{stages.map(([name, v, note]) => <div key={name} className="po-stage"><span><b>{name}</b>{note ? <span className="muted sm" style={{ display: 'block' }}>{note}</span> : null}</span><span className="po-stage-bar"><i style={{ width: `${Math.max(1, v * 100)}%` }} /></span><Pct v={v} className="num" /></div>)}</div>
      </section>

      {path.length > 0 && <section className="hsec">
        <h2>Path to the tournament</h2>
        <p className="muted hsub">Games in the next three days that move {t.name}'s chances most.</p>
        <div className="po-path">{path.map(({ g, d }) => { const win = d > 0 ? g.h : g.a; return <button key={g.key} className={`po-step ${s.locks[g.key] === win ? 'on' : ''}`} onClick={() => pickB(g.key, win, pickText(p, g, win))}><span><b>{pickText(p, g, win)}</b><span className="muted sm"> {new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></span><span className="num up">+{Math.abs(Math.round(d * 100))}</span></button>; })}</div>
      </section>}

      {mine.length > 0 && <section className="hsec">
        <h2>Next games</h2>
        <div className="po-path">{mine.map((g) => { const home = g.h === ti, opp = home ? g.a : g.h, pw = home ? g.p : 1 - g.p; return <div key={g.key} className="po-step static"><span><b>{g.neutral || home ? 'vs' : 'at'} {opp >= 0 ? p.teams[opp].name : 'a lower-division team'}</b><span className="muted sm"> {new Date(g.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></span><span className="num">{pct(pw)} to win</span></div>; })}</div>
      </section>}
      <Link to={`${base}/tournament`} className="po-more" style={{ textAlign: 'center' }}>See every team's chances</Link>
      <Toast s={s} />
    </div>
  );
}
