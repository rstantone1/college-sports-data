import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCtx, useFollows } from '../hooks';
import { ShareButton, type Card } from '../components/ShareCard';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { pct } from '../model';
import { usePlayoff, init, hydrateLocks, pick, setLocks, reset, setChaos, clearRipple, shareUrl, randomSeason, type State } from '../playoff/store';
import type { Pack, PGame, Result } from '../playoff/sim';

// ---- small pieces shared with the team page ----

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A percentage that counts to its new value instead of jumping.
export function Pct({ v, className }: { v: number; className?: string }) {
  const [shown, setShown] = useState(v); const from = useRef(v);
  useEffect(() => {
    if (still() || Math.abs(v - from.current) < 0.004) { from.current = v; setShown(v); return; }
    const a = from.current, t0 = performance.now(); let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 420), e = 1 - Math.pow(1 - k, 3); const x = a + (v - a) * e; from.current = x; setShown(x); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [v]);
  return <span className={className}>{pct(shown)}</span>;
}

// Rows slide to their new place when the order changes.
export function useFlip(order: string) {
  const els = useRef(new Map<number, HTMLElement>()), tops = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    const now = new Map<number, number>();
    els.current.forEach((el, id) => { if (el.isConnected) now.set(id, el.offsetTop); });
    if (!still()) now.forEach((top, id) => { const old = tops.current.get(id); if (old != null && Math.abs(old - top) > 2) els.current.get(id)!.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
    tops.current = now;
  }, [order]);
  return (id: number) => (el: HTMLElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); };
}

export const Logo = ({ src, size = 28 }: { src: string | null; size?: number }) => (src ? <img src={src} alt="" width={size} height={size} loading="lazy" style={{ objectFit: 'contain', flex: '0 0 auto' }} /> : <span style={{ width: size, height: size, flex: '0 0 auto' }} />);
const delta = (d: number) => (Math.abs(d) < 0.01 ? null : <span className={`po-delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d * 100))}</span>);
export const gameLabel = (p: Pack, g: PGame) => `${g.a >= 0 ? p.teams[g.a].name : 'FCS opponent'} ${g.neutral ? 'vs' : 'at'} ${g.h >= 0 ? p.teams[g.h].name : 'FCS opponent'}`;
export function pickText(p: Pack, key: string, win: number): string {
  if (key.startsWith('t:')) return `${p.teams[win].name} wins the ${p.confs[Number(key.slice(2))].name} title`;
  const g = p.games.find((x) => x.key === key); if (!g) return '';
  const lose = g.h === win ? g.a : g.h; return `${p.teams[win].name} beats ${lose >= 0 ? p.teams[lose].name : 'its FCS opponent'}`;
}
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

type Metric = 'make' | 'bye' | 'title';
const METRICS: { id: Metric; label: string }[] = [{ id: 'make', label: 'Make the playoff' }, { id: 'bye', label: 'First-round bye' }, { id: 'title', label: 'Win it all' }];
const val = (r: Result, m: Metric, i: number) => (m === 'make' ? r.make[i] : m === 'bye' ? r.bye[i] : r.reach[r.reach.length - 1][i]);

// ---- the board ----

function Board({ s, base }: { s: State; base: string }) {
  const p = s.pack!, cur = s.cur ?? s.base!, b0 = s.base!;
  const [metric, setMetric] = useState<Metric>('make'); const [all, setAll] = useState(false);
  const changed = Object.keys(s.locks).length > 0 || s.chaos !== 1;
  const order = useMemo(() => p.teams.map((_, i) => i).sort((a, b) => val(cur, metric, b) - val(cur, metric, a) || cur.make[b] - cur.make[a] || p.teams[a].ourRank - p.teams[b].ourRank), [cur, metric, p]);
  const shown = order.filter((i, n) => all || n < p.format.size || cur.make[i] >= 0.01 || b0.make[i] >= 0.01);
  const flip = useFlip(shown.join(','));
  return (
    <div>
      <div className="chips scroll">{METRICS.map((m) => <button key={m.id} className={`chip ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>{m.label}</button>)}</div>
      <div className="po-board" style={{ opacity: s.busy ? 0.75 : 1 }}>
        {shown.map((i, n) => {
          const t = p.teams[i], v = val(cur, metric, i), d = changed ? v - val(b0, metric, i) : 0;
          return (
            <div key={t.id} ref={flip(t.id)}>
              {n === p.format.size && metric === 'make' && <div className="po-cut"><span>The field is {p.format.size}</span></div>}
              <Link to={`${base}/playoff/${t.id}${location.search}`} className="po-row">
                <span className="po-n">{n + 1}</span>
                <Logo src={t.logo} size={34} />
                <span className="po-name"><b>{t.name}</b><span className="muted">{t.w}-{t.l}{t.cfp ? ` · CFP #${t.cfp}` : ''}</span></span>
                <span className="po-val">{delta(d)}<Pct v={v} className="po-pct" /></span>
                <span className="po-bar"><i style={{ width: `${Math.max(1.5, v * 100)}%`, background: v >= 0.75 ? 'var(--win)' : v >= 0.25 ? 'var(--gold)' : 'var(--muted)' }} /></span>
              </Link>
            </div>
          );
        })}
      </div>
      <button className="po-more" onClick={() => setAll(!all)}>{all ? 'Show only teams with a chance' : `Show all ${p.teams.length} teams`}</button>
      <div style={{ marginTop: 10 }}><ShareButton label="Share this board" card={(): Card => ({ kind: 'board', title: changed ? 'My playoff scenario' : 'Playoff picture', sub: changed ? Object.entries(s.locks).slice(0, 3).map(([k, v]) => pickText(p, k, v)).join(' · ') + (Object.keys(s.locks).length > 3 ? ' and more' : '') : `Chance to make the ${p.format.size}-team field`, rows: order.slice(0, 12).map((i) => ({ name: p.teams[i].name, logo: p.teams[i].logo, value: pct(val(cur, metric, i)), frac: val(cur, metric, i) })) })} /></div>
    </div>
  );
}

// ---- play it out ----

function GameRow({ s, g, gi }: { s: State; g: PGame; gi: number }) {
  const p = s.pack!, cur = s.cur ?? s.base!, lv = cur.lev; const picked = s.locks[g.key];
  const k = lv ? lv.games.indexOf(gi) : -1;
  let swing: { name: string; d: number } | null = null;
  if (lv && k >= 0) { let bd = 0.03; for (let ti = 0; ti < lv.teams.length; ti++) { const d = Math.abs(lv.d[k * lv.teams.length + ti]); if (d > bd) { bd = d; swing = { name: p.teams[lv.teams[ti]].name, d }; } } }
  const side = (idx: number, pw: number) => {
    if (idx < 0) return <span className="po-side off"><span className="po-side-n">FCS opponent</span><span className="num">{pct(pw)}</span></span>;
    const t = p.teams[idx], on = picked === idx, off = picked != null && !on;
    return (
      <button className={`po-side ${on ? 'on' : ''} ${off ? 'dim' : ''}`} onClick={() => pick(g.key, idx, pickText(p, g.key, idx))} aria-pressed={on}>
        <Logo src={t.logo} size={30} /><span className="po-side-n">{t.name}</span><span className="num">{on ? 'Wins' : pct(pw)}</span>
      </button>
    );
  };
  return (
    <div className="po-game">
      <div className="po-game-top"><span>{g.live ? <><span className="po-live">Live</span> {g.live.as}–{g.live.hs} · {g.live.detail}</> : day(g.date)}</span>{swing && <span>Means most to {swing.name}</span>}</div>
      <div className="po-sides">{side(g.a, 1 - g.p)}<span className="po-at">{g.neutral ? 'vs' : 'at'}</span>{side(g.h, g.p)}</div>
    </div>
  );
}

function Play({ s }: { s: State }) {
  const p = s.pack!, cur = s.cur ?? s.base!, lv = cur.lev; const [open, setOpen] = useState<Record<number, boolean>>({}); const [simming, setSimming] = useState(false);
  const impact = useMemo(() => { const m = new Map<number, number>(); if (lv) lv.games.forEach((gi, k) => m.set(gi, lv.impact[k])); return m; }, [lv]);
  // Keep each game's importance from the starting picture, so the list doesn't reshuffle under the user's thumb.
  const baseImpact = useMemo(() => { const m = new Map<number, number>(); const l0 = s.base!.lev; if (l0) l0.games.forEach((gi, k) => m.set(gi, l0.impact[k])); return m; }, [s.base]);
  const weeks = useMemo(() => { const by = new Map<number, number[]>(); p.games.forEach((g, i) => { if (g.h < 0 && g.a < 0) return; if (!by.has(g.week)) by.set(g.week, []); by.get(g.week)!.push(i); }); return [...by.entries()].sort((a, b) => a[0] - b[0]); }, [p]);
  const matters = (gi: number) => (baseImpact.get(gi) ?? 0) >= 0.06 || (impact.get(gi) ?? 0) >= 0.06 || p.games[gi].key in s.locks;
  const simSeason = async () => {
    setSimming(true); const { picks } = await randomSeason(); const acc = { ...s.locks };
    for (const [, ids] of weeks) { for (const gi of ids) { const g = p.games[gi]; if (g.key in picks) acc[g.key] = picks[g.key]; } await setLocks({ ...acc }); await new Promise((r) => setTimeout(r, still() ? 0 : 650)); }
    for (const [k, v] of Object.entries(picks)) if (k.startsWith('t:')) acc[k] = v;
    await setLocks({ ...acc }, 'One way the season could go'); setSimming(false);
  };
  const first = weeks[0]?.[0];
  return (
    <div>
      <div className="po-tools">
        <button className="po-btn" disabled={simming} onClick={simSeason}>{simming ? 'Playing it out…' : 'Sim the season'}</button>
        <label className="po-chaos"><span>Chalk</span><input type="range" min={-1} max={1} step={0.25} value={Math.log2(1 / s.chaos) / 2} onChange={(e) => setChaos(1 / Math.pow(2, Number(e.target.value) * 2))} aria-label="How wild the rest of the season gets" /><span>Chaos</span></label>
      </div>
      <p className="muted po-hint">Tap a winner and watch every team's chances move. Tap it again to undo.</p>
      {weeks.map(([wk, ids]) => {
        const sorted = [...ids].sort((a, b) => (baseImpact.get(b) ?? 0) - (baseImpact.get(a) ?? 0) || p.games[a].date - p.games[b].date);
        const top = sorted.filter(matters), rest = sorted.filter((gi) => !matters(gi));
        const lo = Math.min(...ids.map((i) => p.games[i].date)), hi = Math.max(...ids.map((i) => p.games[i].date));
        const title = wk === first ? 'This week' : `${new Date(lo).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(hi).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        return (
          <section key={wk} className="po-week">
            <h3>{title}</h3>
            {top.length ? top.map((gi) => <GameRow key={p.games[gi].key} s={s} g={p.games[gi]} gi={gi} />) : <p className="muted">No game this week moves the playoff picture much.</p>}
            {rest.length > 0 && (open[wk]
              ? rest.map((gi) => <GameRow key={p.games[gi].key} s={s} g={p.games[gi]} gi={gi} />)
              : <button className="po-more" onClick={() => setOpen({ ...open, [wk]: true })}>Show {rest.length} more {rest.length === 1 ? 'game' : 'games'}</button>)}
          </section>
        );
      })}
      <section className="po-week">
        <h3>Championship weekend</h3>
        <p className="muted po-hint">Pick a conference champion. The teams shown are the likeliest to reach each title game.</p>
        {p.confs.map((cf, c) => {
          if (!cf.title) return null; const key = `t:${c}`, picked = s.locks[key];
          const cands = [...cf.teams].sort((a, b) => cur.titleGame[b] - cur.titleGame[a]).filter((i, n) => n < 4 && (cur.titleGame[i] >= 0.04 || picked === i));
          return (
            <div key={c} className="po-game">
              <div className="po-game-top"><span>{cf.name} title game</span>{cf.power ? <span>Winner is in the playoff</span> : null}</div>
              <div className="po-cands">{cands.map((i) => { const t = p.teams[i], on = picked === i;
                return <button key={i} className={`po-side ${on ? 'on' : ''} ${picked != null && !on ? 'dim' : ''}`} onClick={() => pick(key, i, pickText(p, key, i))} aria-pressed={on}><Logo src={t.logo} size={30} /><span className="po-side-n">{t.name}</span><span className="num">{on ? 'Champion' : `${pct(cur.confChamp[i])} to win it`}</span></button>; })}</div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ---- projected bracket ----

function Bracket({ s, base }: { s: State; base: string }) {
  const p = s.pack!, cur = s.cur ?? s.base!, ch = s.chalk; if (!ch) return <Loading rows={6} />;
  const F = p.format, picks = Object.keys(s.locks).length;
  const chip = (seed: number) => { const i = ch.seeds[seed - 1]; if (i == null || i < 0) return <span className="po-seed empty">TBD</span>; const t = p.teams[i];
    return <Link to={`${base}/playoff/${t.id}${location.search}`} className="po-seed"><span className="po-n">{seed}</span><Logo src={t.logo} size={30} /><span className="po-name"><b>{t.name}</b><span className="muted">{ch.auto[seed - 1] ? `${p.confs[t.conf]?.name ?? ''} champion · ` : ''}{pct(cur.make[i])} to get in</span></span></Link>; };
  const inField = new Set(ch.seeds); const out = p.teams.map((_, i) => i).filter((i) => !inField.has(i)).sort((a, b) => cur.make[b] - cur.make[a]).slice(0, 4);
  return (
    <div>
      <p className="muted po-hint">{picks ? 'Your picks, with the favorite winning every game you left alone.' : 'The bracket if the favorite wins every game from here.'} Seeds follow the committee's ranking; the top {F.byes} sit out the first round.</p>
      <h3>First-round byes</h3>
      <div className="po-bracket">{Array.from({ length: F.byes }, (_, j) => <div key={j} className="po-match">{chip(j + 1)}</div>)}</div>
      <h3 style={{ marginTop: 18 }}>First round, on campus</h3>
      <div className="po-bracket">{Array.from({ length: F.byes }, (_, j) => { const hi = F.byes + 1 + j, lo = F.size - j; return <div key={j} className="po-match">{chip(hi)}<span className="po-at">hosts</span>{chip(lo)}<span className="muted sm">Winner plays the No. {F.byes - j} seed</span></div>; })}</div>
      <h3 style={{ marginTop: 18 }}>First teams out</h3>
      <div className="po-bracket">{out.map((i) => { const t = p.teams[i]; return <Link key={i} to={`${base}/playoff/${t.id}${location.search}`} className="po-seed"><Logo src={t.logo} size={30} /><span className="po-name"><b>{t.name}</b><span className="muted">{t.w}-{t.l} · {pct(cur.make[i])} to get in</span></span></Link>; })}</div>
    </div>
  );
}

// ---- the toast that says who a result just helped and hurt ----

export function RippleToast({ s }: { s: State }) {
  const r = s.ripple;
  useEffect(() => { if (!r) return; const t = setTimeout(clearRipple, 6500); return () => clearTimeout(t); }, [r?.at]);
  if (!r || !s.pack) return null;
  return (
    <div className="po-toast" role="status" onClick={clearRipple}>
      <b>{r.title}</b>
      {r.moves.map((m) => <div key={m.team} className="po-toast-row"><span>{s.pack!.teams[m.team].name}</span><span className="num">{pct(m.from)} → <b className={m.to > m.from ? 'up' : 'dn'}>{pct(m.to)}</b></span></div>)}
    </div>
  );
}

// What each team's chances were the last time this person looked, kept on their device.
const SEEN = 'po:seen';
function useSeen(s: State) {
  const [seen] = useState<Record<string, { v: number; t: number }>>(() => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '{}'); } catch { return {}; } });
  useEffect(() => { if (!s.pack || !s.base) return; const t = setTimeout(() => { try { const now: Record<string, { v: number; t: number }> = {}; s.pack!.teams.forEach((tm, i) => { if (s.base!.make[i] > 0.002) now[tm.id] = { v: s.base!.make[i], t: Date.now() }; }); localStorage.setItem(SEEN, JSON.stringify(now)); } catch { /* unavailable */ } }, 20000); return () => clearTimeout(t); }, [s.pack, s.base]);
  return seen;
}

// The followed teams' chances, what changed since last time, and the games on in the next day and a half that matter to them.
function YourTeams({ s, base }: { s: State; base: string }) {
  const { list } = useFollows(); const seen = useSeen(s); const p = s.pack!, r = s.base!, lv = r.lev;
  const mine = list.filter((f) => f.sport === 'cfb').map((f) => p.teams.findIndex((t) => t.id === f.team_id)).filter((i) => i >= 0);
  if (!mine.length) return null; const soon = Date.now() + 36 * 3600e3;
  return (
    <div className="po-yours">{mine.map((ti) => { const t = p.teams[ti], was = seen[t.id], d = was && Date.now() - was.t > 3600e3 ? r.make[ti] - was.v : 0; const k = lv ? lv.teams.indexOf(ti) : -1;
      const games = lv && k >= 0 ? lv.games.map((gi, n) => ({ g: p.games[gi], d: lv.d[n * lv.teams.length + k] })).filter((x) => x.g.date < soon && Math.abs(x.d) >= 0.025 && x.g.h >= 0 && x.g.a >= 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3) : [];
      return (
        <Link key={t.id} to={`${base}/playoff/${t.id}${location.search}`} className="po-your">
          <div className="po-your-top"><Logo src={t.logo} size={36} /><b>{t.name}</b>{Math.abs(d) >= 0.01 && <span className={`po-delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d * 100))} since {new Date(was!.t).toLocaleDateString(undefined, { weekday: 'short' })}</span>}<span className="num">{pct(r.make[ti])}</span></div>
          {games.length > 0 ? <ul>{games.map(({ g, d }) => { const win = d > 0 ? g.h : g.a; return <li key={g.key}><span>{pickText(p, g.key, win)}{g.live ? ' · live' : ''}</span><b className="up">+{Math.abs(Math.round(d * 100))}</b></li>; })}</ul>
            : <ul><li><span className="muted">{r.make[ti] > 0.99 ? 'In from almost anywhere.' : r.make[ti] < 0.005 ? 'Out of the picture.' : 'Nothing in the next day moves their chances much.'}</span></li></ul>}
        </Link>
      ); })}</div>
  );
}

export function ScenarioBar({ s }: { s: State }) {
  const n = Object.keys(s.locks).length; const [copied, setCopied] = useState(false);
  if (!n && s.chaos === 1) return null;
  const share = async () => { const url = shareUrl(); try { if (navigator.share) await navigator.share({ title: 'Playoff scenario', url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } } catch { /* closed the share sheet */ } };
  return (
    <div className="po-scn">
      <span><b>Your scenario</b> · {n ? `${n} ${n === 1 ? 'pick' : 'picks'}` : 'no picks'}{s.chaos !== 1 ? (s.chaos < 1 ? ' · more chaos' : ' · more chalk') : ''}{s.cur?.rare ? ' · almost never happens' : ''}</span>
      <span className="po-scn-b"><button onClick={share}>{copied ? 'Link copied' : 'Share'}</button><button onClick={reset}>Reset</button></span>
    </div>
  );
}

export function usePlayoffData() {
  const { season } = useCtx(); const s = usePlayoff();
  useEffect(() => { init(season); }, [season]);
  useEffect(() => { if (s.status === 'ready') hydrateLocks(); }, [s.status]);
  return s;
}

export function PlayoffPage() {
  const { base } = useCtx(); const s = usePlayoffData();
  const [tab, setTab] = useState<'board' | 'play' | 'bracket'>('board');
  if (s.status === 'error') return <><Back /><ErrorBox msg={s.error ?? ''} /></>;
  if (s.status !== 'ready' || !s.pack || !s.base) return <><Back /><h1>Playoff picture</h1><p className="sub">Playing out the rest of the season 6,000 times…</p><Loading rows={10} /></>;
  const p = s.pack, left = p.games.length;
  return (
    <div className="po">
      <Back />
      <h1>Playoff picture</h1>
      <p className="sub" style={{ marginBottom: 14 }}>Each team's chance to make the {p.format.size}-team field. {left ? 'It moves every time a game ends.' : 'The regular season is done.'}{s.live ? <> <span className="po-live">{s.live} live now</span></> : null}</p>
      <ScenarioBar s={s} />
      <YourTeams s={s} base={base} />
      <div className="po-tabs" role="tablist">
        {([['board', 'The board'], ['play', 'Play it out'], ['bracket', 'Bracket']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className={`po-grid show-${tab}`}>
        <div className="po-col po-c-board"><Board s={s} base={base} /></div>
        <div className="po-col po-c-play"><Play s={s} /></div>
        <div className="po-col po-c-bracket"><Bracket s={s} base={base} /></div>
      </div>
      <details className="panel po-how">
        <summary>How this works</summary>
        <p>We play every remaining game using our win chances (for a game in progress, the score and clock take over), settle each conference's title game, then rank the teams the way the committee does and fill the bracket under this year's rules: the four power-conference champions, the best champion from the other leagues, and the committee's highest-ranked teams after that. Then we do it 5,999 more times and count.</p>
        <p>The committee part is learned from every weekly ranking it has published since 2014. It mostly rewards who you beat and where (wins a bubble team wouldn't have gotten), how good you look, and how few losses you have. Tested on the last three seasons, which it never saw, it matched 11 of the committee's final top 12 on average. Each simulated season also starts from the committee's own latest ranking{s.cfpDate ? `, released ${new Date(s.cfpDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : ''}, because the committee tends to stick with what it has already said.</p>
        <p>It's an estimate. Conference tiebreakers are simplified to record, head-to-head, then résumé, and thirteen people in a room can always surprise you.</p>
      </details>
      <RippleToast s={s} />
    </div>
  );
}
