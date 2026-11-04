import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { restAll, type Game, type Rating } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Loading, ErrorBox, TeamCell } from '../components/Shell';
import { predict, league, pct, sign, perGame } from '../model';

// Tournament odds by simulation. Each run: play out every remaining game using the model's win chances, then pick a
// field the way a selection committee roughly does: one automatic bid per conference (its best-rated team wins the
// conference tournament with probability proportional to rating), then the best remaining teams by a blend of rating
// and record. Across many runs, how often does each team get in, and on what seed line?

interface Sim { team_id: number; inPct: number; autoPct: number; seedAvg: number | null; projW: number; projL: number; w: number; l: number; }

function simulate(rs: Rating[], games: Game[], sport: string, runs: number, field: number, atLargeRank: number): Sim[] {
  const L = league(rs);
  const byId = new Map(rs.map((r) => [r.team_id, r]));
  const rec = new Map<number, { w: number; l: number }>();
  for (const r of rs) rec.set(r.team_id, { w: 0, l: 0 });
  const remaining: { h: number; a: number; p: number }[] = [];
  for (const g of games) {
    const H = byId.get(g.home_team_id), A = byId.get(g.away_team_id);
    if (!H || !A) continue;
    if (g.completed && g.home_score != null) {
      const hw = g.home_score > g.away_score!;
      rec.get(H.team_id)!.w += hw ? 1 : 0; rec.get(H.team_id)!.l += hw ? 0 : 1;
      rec.get(A.team_id)!.w += hw ? 0 : 1; rec.get(A.team_id)!.l += hw ? 1 : 0;
    } else {
      remaining.push({ h: H.team_id, a: A.team_id, p: predict(H, A, L, g.neutral_site ? 0 : 1, sport).aWin });
    }
  }
  const confs = new Map<number, Rating[]>();
  for (const r of rs) if (r.conference_id) { if (!confs.has(r.conference_id)) confs.set(r.conference_id, []); confs.get(r.conference_id)!.push(r); }
  const inCount = new Map<number, number>(), autoCount = new Map<number, number>(), seedSum = new Map<number, number>(), winSum = new Map<number, number>();
  const rankOf = new Map(rs.map((r) => [r.team_id, r.rank]));

  for (let i = 0; i < runs; i++) {
    const w = new Map<number, number>(), l = new Map<number, number>();
    for (const [t, x] of rec) { w.set(t, x.w); l.set(t, x.l); }
    for (const g of remaining) {
      if (Math.random() < g.p) { w.set(g.h, w.get(g.h)! + 1); l.set(g.a, l.get(g.a)! + 1); }
      else { w.set(g.a, w.get(g.a)! + 1); l.set(g.h, l.get(g.h)! + 1); }
    }
    for (const [t, x] of w) winSum.set(t, (winSum.get(t) ?? 0) + x);
    const chosen = new Set<number>();
    // Automatic bids: sample a conference-tournament winner, favoring strength.
    for (const members of confs.values()) {
      const weights = members.map((m) => Math.exp(m.adj_em / 6));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      let pick = members[0];
      for (let k = 0; k < members.length; k++) { r -= weights[k]; if (r <= 0) { pick = members[k]; break; } }
      chosen.add(pick.team_id); autoCount.set(pick.team_id, (autoCount.get(pick.team_id) ?? 0) + 1);
    }
    // At-large: resume score = rating rank blended with win percentage.
    const score = (t: number) => { const g = w.get(t)! + l.get(t)!; const wp = g ? w.get(t)! / g : 0.5; return rankOf.get(t)! - 60 * (wp - 0.5); };
    const pool = rs.filter((r) => !chosen.has(r.team_id)).map((r) => ({ t: r.team_id, s: score(r.team_id) })).sort((a, b) => a.s - b.s);
    for (const x of pool) { if (chosen.size >= field) break; if (x.s <= atLargeRank + 20) chosen.add(x.t); }
    // Seed lines: order the field by resume score, 4 teams per line.
    const ordered = [...chosen].map((t) => ({ t, s: score(t) })).sort((a, b) => a.s - b.s);
    ordered.forEach((x, idx) => { inCount.set(x.t, (inCount.get(x.t) ?? 0) + 1); seedSum.set(x.t, (seedSum.get(x.t) ?? 0) + Math.min(16, Math.floor(idx / 4) + 1)); });
  }
  const total = (t: number) => { const r = rec.get(t)!; return { w: r.w, l: r.l, left: remaining.filter((g) => g.h === t || g.a === t).length }; };
  return rs.map((r) => {
    const n = inCount.get(r.team_id) ?? 0, tt = total(r.team_id);
    const pw = (winSum.get(r.team_id) ?? 0) / runs;
    return { team_id: r.team_id, inPct: n / runs, autoPct: (autoCount.get(r.team_id) ?? 0) / runs, seedAvg: n ? seedSum.get(r.team_id)! / n : null,
      projW: pw, projL: tt.w + tt.l + tt.left - pw, w: tt.w, l: tt.l };
  }).sort((a, b) => b.inPct - a.inPct || (a.seedAvg ?? 99) - (b.seedAvg ?? 99));
}

export function TournamentPage() {
  const { sport, season, base, meta } = useCtx();
  const R = useRatings();
  const games = useAsync(() => restAll<Game>(`v_games?sport_id=eq.${sport}&season_year=eq.${season}&select=id,home_team_id,away_team_id,home_score,away_score,completed,neutral_site&order=id.asc`), [sport, season]);
  const [sims, setSims] = useState<Sim[] | null>(null);
  const [view, setView] = useState<'field' | 'bubble' | 'all'>('field');
  const nav = useNavigate();
  const T = meta.tourney;

  useEffect(() => {
    if (!R.data || !games.data || !T) return;
    setSims(null);
    const t = setTimeout(() => setSims(simulate(R.data!, games.data!, sport, 1000, T.field, T.atLargeRank)), 30);
    return () => clearTimeout(t);
  }, [R.data, games.data, sport, T]);

  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  if (!T) return <div className="panel empty"><h2>Postseason odds aren't modeled for {meta.long} yet.</h2><p>Basketball first; the playoff and the College World Series come next.</p></div>;
  if (R.loading || games.loading) return <Loading />;
  if (R.error) return <ErrorBox msg={R.error} />;
  if (!sims) return <div className="panel empty">Simulating the rest of the season 1,000 times…</div>;

  const remainingGames = (games.data ?? []).filter((g) => !g.completed).length;
  const rows = view === 'field' ? sims.filter((s) => s.inPct >= 0.5).slice(0, 68)
    : view === 'bubble' ? sims.filter((s) => s.inPct > 0.1 && s.inPct < 0.9)
    : sims;
  const locks = sims.filter((s) => s.inPct > 0.95).length, bubble = sims.filter((s) => s.inPct > 0.2 && s.inPct < 0.8).length;

  return (
    <>
      <h1>Tournament odds</h1>
      <p className="sub">The rest of the season, played out 1,000 times with the model's win chances, then a 68-team field picked each time:
        one automatic bid per conference plus the strongest at-large résumés. {remainingGames > 0 ? `${remainingGames.toLocaleString()} games still to play.` : 'Season complete: this is how the model would have seeded it.'}
        {' '}An estimate, not the committee.</p>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><div className="k">Locks</div><div className="v">{locks}</div><div className="r">over 95% to make it</div></div>
        <div className="card"><div className="k">On the bubble</div><div className="v">{bubble}</div><div className="r">between 20% and 80%</div></div>
        <div className="card"><div className="k">Field</div><div className="v">{T.field}</div><div className="r">{T.autoBids} automatic bids</div></div>
      </div>
      <div className="chips">
        <button className={`chip ${view === 'field' ? 'on' : ''}`} onClick={() => setView('field')}>Projected field</button>
        <button className={`chip ${view === 'bubble' ? 'on' : ''}`} onClick={() => setView('bubble')}>Bubble</button>
        <button className={`chip ${view === 'all' ? 'on' : ''}`} onClick={() => setView('all')}>Everyone</button>
      </div>
      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Seed</th><th className="l">Team</th><th className="l hide-sm">Conf</th><th>Record</th><th>Projected</th><th>Make it</th><th className="hide-sm">Auto bid</th><th className="hide-sm">Rating</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const r = byId.get(s.team_id)!;
                const seed = s.seedAvg != null ? Math.round(s.seedAvg) : null;
                return (
                  <tr key={s.team_id} className="row" onClick={() => nav(`${base}/team/${s.team_id}`)}>
                    <td className="rk">{seed && s.inPct >= 0.5 ? seed : '–'}</td>
                    <td className="l"><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></td>
                    <td className="l hide-sm muted">{r.conference_short}</td>
                    <td className="num">{s.w}-{s.l}</td>
                    <td className="num">{s.projW.toFixed(1)}-{s.projL.toFixed(1)}</td>
                    <td className="num" style={{ fontSize: 18, color: s.inPct > 0.8 ? 'var(--win)' : s.inPct < 0.3 ? 'var(--hot)' : 'var(--gold)' }}>{pct(s.inPct)}</td>
                    <td className="hide-sm num">{pct(s.autoPct)}</td>
                    <td className="hide-sm num">#{r.rank} <span className="muted sm">{sign(perGame(r, sport).rating)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend"><span>Seed: average seed line when the team makes it</span><span>Projected: expected final record</span><span>Auto bid: chance of winning its conference tournament</span><span>Rating: national rank and points per game vs. an average team</span></div>
      </div>
      <p className="muted sm" style={{ marginTop: 12 }}>Want the full picture for one team? Open its page from the list, or <Link to={`${base}/ballot`} style={{ color: 'var(--cool)' }}>build your own Top 25</Link>.</p>
    </>
  );
}
