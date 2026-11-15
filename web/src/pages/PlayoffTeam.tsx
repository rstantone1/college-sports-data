import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCtx } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { pct } from '../model';
import { pick, setLocks, teamScenario, drawItUp, seedPaths } from '../playoff/store';
import type { DrawStep, SeedPath, SeedLine } from '../playoff/worker';
import { Pct, Logo, RippleToast, ScenarioBar, usePlayoffData, pickText } from './Playoff';

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const pts = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;

const seedWords = (l: SeedLine) => (l.make < 0.02 ? 'Out' : `${l.make < 0.9 ? `${pct(l.make)} in · ` : ''}No. ${l.mode} seed${l.lo !== l.hi ? ` (${l.lo}–${l.hi})` : ''}`);
function PathRow({ title, sub, line, size, byes, onClick, children }: { title: string; sub: string; line: SeedLine; size: number; byes: number; onClick?: () => void; children?: React.ReactNode }) {
  const top = Math.max(0.0001, ...line.dist);
  return (
    <div className={`po-pathrow ${onClick ? 'tap' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="po-path-head"><span><b>{title}</b><span className="muted sm" style={{ display: 'block' }}>{sub}</span></span><span className="po-path-seed">{line.make < 0.02 ? 'Out' : line.make < 0.35 ? <>Likely out<span className="muted sm" style={{ display: 'block' }}>{pct(line.make)} in, as the No. {line.mode} seed</span></> : <>No. {line.mode}<span className="muted sm" style={{ display: 'block' }}>{line.make >= 0.995 ? 'in' : `${pct(line.make)} in`}{line.bye >= 0.05 ? ` · ${pct(line.bye)} bye` : ''}</span></>}</span></div>
      <div className="po-strip" aria-hidden>
        {Array.from({ length: size }, (_, k) => { const v = line.dist[k + 1]; return <span key={k} className={k < byes ? 'bye' : ''} style={{ ['--a' as any]: v < 0.01 ? 0 : 0.15 + 0.85 * (v / top), color: v / top > 0.5 ? '#fff' : v >= 0.01 ? 'var(--ink)' : undefined }}>{k + 1}</span>; })}
        <span className="out" style={{ ['--a' as any]: line.dist[0] < 0.01 ? 0 : 0.15 + 0.85 * (line.dist[0] / top), color: line.dist[0] / top > 0.5 ? '#fff' : line.dist[0] >= 0.01 ? 'var(--ink)' : undefined }}>Out</span>
      </div>
      {children}
    </div>
  );
}

export function PlayoffTeamPage() {
  const { base } = useCtx(); const { teamId } = useParams(); const nav = useNavigate(); const s = usePlayoffData();
  const p = s.pack, cur = s.cur ?? s.base; const ti = p ? p.teams.findIndex((t) => t.id === Number(teamId)) : -1;
  const [sc, setSc] = useState<Awaited<ReturnType<typeof teamScenario>> | null>(null);
  const [plan, setPlan] = useState<{ start: number; steps: DrawStep[] } | null>(null); const [shown, setShown] = useState(0); const [drawing, setDrawing] = useState(false);
  const [sp, setSp] = useState<{ games: string[]; rows: SeedPath[] } | null>(null);
  const lockKey = JSON.stringify(s.locks) + s.chaos + s.updated;
  useEffect(() => { if (ti < 0 || s.status !== 'ready') return; let live = true; setSc(null); setPlan(null); setSp(null); teamScenario(ti).then((r) => live && setSc(r)).then(() => seedPaths(ti)).then((r) => live && setSp(r)); return () => { live = false; }; }, [ti, lockKey, s.status]);
  useEffect(() => { if (!plan || shown >= plan.steps.length) return; const t = setTimeout(() => setShown(shown + 1), 700); return () => clearTimeout(t); }, [plan, shown]);

  // Games that move this team's chances the most, its own and everyone else's.
  const path = useMemo(() => {
    if (!p || !cur?.lev || ti < 0) return []; const lv = cur.lev, k = lv.teams.indexOf(ti); if (k < 0) return [];
    return lv.games.map((gi, n) => ({ g: p.games[gi], d: lv.d[n * lv.teams.length + k] })).filter((x) => Math.abs(x.d) >= 0.025 && x.g.h >= 0 && x.g.a >= 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8);
  }, [p, cur, ti]);

  if (s.status === 'error') return <><Back /><ErrorBox msg={s.error ?? ''} /></>;
  if (s.status !== 'ready' || !p || !cur) return <><Back /><Loading rows={10} /></>;
  if (ti < 0) return <><Back /><div className="panel empty">That team isn't in this season's playoff picture.</div></>;
  const t = p.teams[ti], b0 = s.base!, F = p.format, size = F.size, changed = Object.keys(s.locks).length > 0 || s.chaos !== 1;
  const make = cur.make[ti], d = changed ? make - b0.make[ti] : 0;
  let bestSeed = -1, bs = 0; for (let k = 0; k < size; k++) if (cur.seeds[ti * size + k] > bs) { bs = cur.seeds[ti * size + k]; bestSeed = k + 1; }
  const resumeRank = [...p.teams.keys()].sort((a, b) => p.teams[b].wab - p.teams[a].wab).indexOf(ti) + 1;
  const stages: [string, number, string?][] = [
    ['First-round bye', cur.bye[ti], `a top-${F.byes} seed`], ['Host a first-round game', cur.host[ti], `seeds ${F.byes + 1}–${F.byes * 2}`],
    ['In as a conference champion', cur.auto[ti], 'automatic bid'], ['In as an at-large', Math.max(0, make - cur.auto[ti]), "the committee's pick"],
    ...(t.conf >= 0 ? [[`Win the ${p.confs[t.conf].name}`, cur.confChamp[ti], `${pct(cur.titleGame[ti])} to reach the title game`] as [string, number, string]] : []),
    ...F.rounds.map((name, r) => [r === F.rounds.length - 1 ? name : `Reach the ${name.toLowerCase()}`, cur.reach[r][ti]] as [string, number]),
  ];
  const mine = p.games.filter((g) => g.h === ti || g.a === ti);
  const draw = async () => { setDrawing(true); setShown(0); const r = await drawItUp(ti); setPlan(r); setDrawing(false); };
  const apply = async () => { if (!plan) return; const locks = { ...s.locks }; for (const st of plan.steps) locks[st.key] = st.win; await setLocks(locks, `${t.name}'s way in`); nav(`${base}/playoff${location.search}`); };
  const last = plan?.steps[plan.steps.length - 1];

  return (
    <div className="po">
      <Back />
      <div className="po-thead"><Logo src={t.logo} size={64} /><div><h1 style={{ marginBottom: 2 }}>{t.name}</h1><div className="muted">{t.w}-{t.l}{t.conf >= 0 ? ` · ${t.cw}-${t.cl} ${p.confs[t.conf].name}` : ''}{t.cfp ? ` · CFP #${t.cfp}` : ''}</div></div></div>
      <ScenarioBar s={s} />

      <div className="po-hero">
        <div className="k">Make the playoff</div>
        <div className="v"><Pct v={make} />{Math.abs(d) >= 0.01 ? <span className={`po-delta ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(Math.round(d * 100))}</span> : null}</div>
        <div className="muted">{make >= 0.005 && bestSeed > 0 ? `Most often the No. ${bestSeed} seed` : 'Not in any of our 6,000 seasons'}{' · '}Committee {t.cfp ? `#${t.cfp}` : 'unranked'} · résumé {ord(resumeRank)} · our power rating {ord(t.ourRank)}</div>
      </div>

      <div className="cards po-if">
        <div className="card"><div className="k">If they win out</div><div className="v">{sc ? pct(sc.winout.make) : '…'}</div><div className="r">{sc ? (sc.left ? `${pct(sc.pWin)} to win their last ${sc.left === 1 ? 'game' : sc.left} · title game included if they get there` : 'no games left to lose') : ' '}</div></div>
        <div className="card"><div className="k">If they lose one more</div><div className="v">{sc ? (sc.loseone ? pct(sc.loseone.make) : '–') : '…'}</div><div className="r">{sc?.loseone ? 'one loss in the regular season' : sc ? 'regular season is done' : ' '}</div></div>
      </div>

      <section className="hsec">
        <h2>Seed paths</h2>
        <p className="muted hsub">Where {t.name} lands for each way their remaining games can go. Darker boxes are likelier seeds. Tap a path to put it on the board.</p>
        {!sp ? <Loading rows={3} /> : !sp.games.length ? <div className="po-paths"><PathRow title="From here" sub="No regular-season games left to play" line={sp.rows[0].all} size={size} byes={F.byes} /></div> : (
          <div className="po-paths">{sp.rows.map((r, i) => {
            const title = r.wins.map((w, k) => { const g = p.games.find((x) => x.key === r.keys[k])!; const opp = g.h === ti ? g.a : g.h; return `${w ? 'Beat' : 'Lose to'} ${opp >= 0 ? p.teams[opp].name : 'FCS opponent'}`; }).join(', then ').replace(/, then (Beat|Lose)/g, (_, v) => `, then ${v.toLowerCase()}`);
            const apply = () => { const locks = { ...s.locks }; r.keys.forEach((k, n) => { const g = p.games.find((x) => x.key === k)!; const opp = g.h === ti ? g.a : g.h; if (r.wins[n]) locks[k] = ti; else if (opp >= 0) locks[k] = opp; }); setLocks(locks, title); };
            const cn = t.conf >= 0 ? p.confs[t.conf].name : '';
            return (
              <PathRow key={i} title={title} sub={`Happens ${pct(r.p)} of the time`} line={r.all} size={size} byes={F.byes} onClick={apply}>
                {r.champ && <div className="po-path-sub"><span>…and win the {cn} title <span className="muted">({pct(r.pChamp)})</span></span><b>{seedWords(r.champ)}</b></div>}
                {r.noChamp && <div className="po-path-sub"><span>…without the {cn} title</span><b>{seedWords(r.noChamp)}</b></div>}
              </PathRow>
            );
          })}</div>
        )}
        {sp && sp.games.length === 3 && mine.length > 3 && <p className="muted sm" style={{ marginTop: 8 }}>Showing their next three games.</p>}
      </section>

      <section className="hsec">
        <h2>How far they go</h2>
        <div className="po-stages">{stages.map(([name, v, note]) => (
          <div key={name} className="po-stage"><span><b>{name}</b>{note ? <span className="muted sm" style={{ display: 'block' }}>{note}</span> : null}</span><span className="po-stage-bar"><i style={{ width: `${Math.max(1, v * 100)}%` }} /></span><Pct v={v} className="num" /></div>
        ))}</div>
      </section>

      <section className="hsec">
        <h2>Path to the CFP</h2>
        <p className="muted hsub">The games that move {t.name}'s chances the most, their own and everyone else's. Tap one to see the board with that result.</p>
        {path.length ? <div className="po-path">{path.map(({ g, d }) => { const win = d > 0 ? g.h : g.a; const picked = s.locks[g.key] === win;
          return <button key={g.key} className={`po-step ${picked ? 'on' : ''}`} onClick={() => pick(g.key, win, pickText(p, g.key, win))}><span><b>{pickText(p, g.key, win)}</b><span className="muted sm"> {new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{g.live ? ' · live' : ''}</span></span><span className="num up">{pts(Math.abs(d))}</span></button>; })}</div>
          : <div className="panel empty">{make > 0.99 ? "They're in from almost anywhere. No single game changes much." : make < 0.005 ? 'No single result gets them back in it.' : 'Nothing left on the schedule moves their chances by much.'}</div>}

        <div className="po-draw">
          <button className="po-btn big" onClick={draw} disabled={drawing}>{drawing ? 'Drawing it up…' : 'Draw it up'}</button>
          <span className="muted">The likeliest run of results that gets {t.name} into the field, one game at a time.</span>
        </div>
        {plan && (plan.steps.length ? (
          <div className="po-plan">
            <div className="po-plan-row"><span className="muted">Right now</span><span className="num">{pct(plan.start)}</span></div>
            {plan.steps.slice(0, shown).map((st, i) => <div key={st.key} className="po-plan-row in"><span><span className="po-n">{i + 1}</span>{pickText(p, st.key, st.win)}</span><span className="num">{pct(st.after)}</span></div>)}
            {shown >= plan.steps.length && last && <>
              <p className="muted" style={{ margin: '10px 0' }}>{last.after >= 0.9 ? 'That gets them in.' : last.after >= 0.5 ? `Even then it's ${pct(last.after)}: they'd still need the committee on their side.` : `Even with all of that it's only ${pct(last.after)}. Realistically they're out.`}</p>
              <button className="po-btn" onClick={apply}>Put this on the board</button></>}
          </div>
        ) : <div className="panel empty">{plan.start > 0.9 ? "Nothing to draw up. They're already in great shape." : 'No games left that would change it.'}</div>)}
      </section>

      {mine.length > 0 && <section className="hsec">
        <h2>Games left</h2>
        <div className="po-path">{mine.map((g) => { const home = g.h === ti, opp = home ? g.a : g.h, pw = home ? g.p : 1 - g.p, picked = s.locks[g.key];
          return <div key={g.key} className="po-step static"><span><b>{g.neutral ? 'vs' : home ? 'vs' : 'at'} {opp >= 0 ? p.teams[opp].name : 'FCS opponent'}</b><span className="muted sm"> {new Date(g.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{g.live ? ` · live ${home ? g.live.hs : g.live.as}–${home ? g.live.as : g.live.hs}` : ''}</span></span><span className="num">{picked != null ? (picked === ti ? 'Win' : 'Loss') : `${pct(pw)} to win`}</span></div>; })}</div>
      </section>}
      <RippleToast s={s} />
    </div>
  );
}
