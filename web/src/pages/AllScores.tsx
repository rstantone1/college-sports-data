import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { restAll, ratingsFor, type Game, type Rating } from '../api';
import { useAsync, useFollows } from '../hooks';
import { Loading } from '../components/Shell';
import { predict, league, outsider, pct } from '../model';
import { SPORTS, sportMeta } from '../sports';
import { GameCard } from './Today';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Every sport's games for a day, like FotMob: a row of dates on top, then one collapsible section per sport.
// Your teams' games come first in each section.
export function AllScoresPage() {
  const [sp, setSp] = useSearchParams();
  const day = sp.get('d') ?? ymd(new Date());
  const start = new Date(`${day}T00:00:00`), end = new Date(start.getTime() + 864e5);
  const { list: follows } = useFollows();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const data = useAsync(() => Promise.all(Object.values(SPORTS).map(async (s) => {
    const season = s.seasons[0].year;
    const [rs, games] = await Promise.all([
      ratingsFor(s.id, season),
      restAll<Game>(`v_games?sport_id=eq.${s.id}&start_time=gte.${start.toISOString()}&start_time=lt.${end.toISOString()}&order=start_time.asc`),
    ]);
    return { s: s.id, season, rs, games };
  })), [day]);

  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { strip.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [day]);
  const days = useMemo(() => Array.from({ length: 11 }, (_, i) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + i - 5); return d; }), []);
  const followed = new Set(follows.map((f) => `${f.sport}:${f.team_id}`));

  return (
    <>
      <h1 style={{ marginBottom: 10 }}>Scores</h1>
      <div className="daystrip" role="tablist" aria-label="Day" ref={strip}>
        {days.map((d) => {
          const k = ymd(d), on = k === day, today = k === ymd(new Date());
          return (
            <button key={k} role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => setSp(today ? {} : { d: k }, { replace: true })}>
              <span>{today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <b>{d.getDate()}</b>
            </button>
          );
        })}
        <input type="date" value={day} aria-label="Pick any day" onChange={(e) => e.target.value && setSp({ d: e.target.value }, { replace: true })} />
      </div>

      {data.loading ? <Loading rows={6} /> : (() => {
        const groups = (data.data ?? []).filter((d) => d.games.length);
        if (!groups.length) return <div className="panel empty">No games on this day in any sport we cover.</div>;
        return groups.map((d) => {
          const byId = new Map<number, Rating>(d.rs.map((r) => [r.team_id, r])); const L = league(d.rs);
          let called = 0, right = 0;
          const cards = d.games.map((g) => {
            const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
            const est = !!((H && !A) || (A && !H));
            const pr = H && A ? predict(H, A, L, g.neutral_site ? 0 : 1, d.s) : est ? predict(H ?? outsider(L, d.s), A ?? outsider(L, d.s), L, g.neutral_site ? 0 : 1, d.s) : null;
            const final = g.completed && g.home_score != null, homeWon = final && g.home_score! > g.away_score!;
            if (final && pr && !est) { called++; if ((pr.aWin >= .5) === homeWon) right++; }
            const mine = followed.has(`${d.s}:${g.home_team_id}`) || followed.has(`${d.s}:${g.away_team_id}`);
            const top = Math.min(H?.rank ?? 999, A?.rank ?? 999);
            return { g, el: <GameCard key={g.id} g={g} H={H} A={A} est={est} pr={pr} final={final} homeWon={homeWon} base={`/${d.s}/${d.season}`} />, mine, top };
          }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.top - b.top);
          const isClosed = closed[d.s];
          return (
            <section key={d.s} className="score-sec">
              <button className="score-sec-head" onClick={() => setClosed({ ...closed, [d.s]: !isClosed })} aria-expanded={!isClosed}>
                <b>{sportMeta(d.s).long}</b>
                <span className="muted sm">{d.games.length} games{called ? ` · our picks ${right}-${called - right} (${pct(right / called)})` : ''}</span>
                <span className="chev">{isClosed ? '▸' : '▾'}</span>
              </button>
              {!isClosed && (
                <>
                  <div className="games">{cards.slice(0, 12).map((c) => c.el)}</div>
                  {cards.length > 12 && <Link to={`/${d.s}/${d.season}/today${day !== ymd(new Date()) ? `?d=${day}` : ''}`} className="btn ghost" style={{ marginTop: 10 }}>All {cards.length} {sportMeta(d.s).short.toLowerCase()} games ›</Link>}
                </>
              )}
            </section>
          );
        });
      })()}
    </>
  );
}
