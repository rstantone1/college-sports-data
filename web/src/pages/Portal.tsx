import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rest, restAll } from '../api';
import { useAsync, useCtx, useRatings } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';
import { pct } from '../model';
import { SPORTS } from '../sports';
import { useBracket, initBracket, ratingWhatIf, type WhatIf } from '../bracket/store';

// How much one unit of last season's production has been worth to next season's team rating (points per 100
// possessions), fitted on four seasons of roster turnover for each sport. Transfers in are scaled by the old team's level.
const COEF: Record<string, { in: number; lost: number }> = { mbb: { in: 0.0057, lost: 0.0043 }, wbb: { in: 0.0075, lost: 0.0072 } };
interface TeamRow { team_id: number; kept: number; lost_moved: number; lost_gone: number; added: number; n_kept: number; n_out: number; n_gone: number; n_in: number }
interface PlayerRow { player_id: number; display_name: string; from_team_id: number; to_team_id: number | null; status: 'kept' | 'moved' | 'gone'; position: string | null; class_year: string | null; gp: number | null; pts: number | null; reb: number | null; ast: number | null; value: number; value_adj: number }
const signed = (v: number) => `${v >= 0.05 ? '+' : v <= -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
const pg = (v: number | null, gp: number | null) => (v != null && gp ? (Number(v) / gp).toFixed(1) : '–');

// Net effect of the portal on each team, in points per game.
export function usePortal() {
  const { sport, season, meta } = useCtx();
  const t = useAsync(() => (COEF[sport] ? restAll<TeamRow>(`v_portal_teams?sport_id=eq.${sport}&season_year=eq.${season}`) : Promise.resolve([])), [sport, season]);
  const c = COEF[sport], per = meta.typicalUnits / 100;
  const rows = useMemo(() => (t.data ?? []).map((r) => { const add = c.in * Number(r.added) * per, lose = c.lost * Number(r.lost_moved) * per; return { ...r, add, lose, net: add - lose }; }), [t.data, sport]);
  return { ...t, rows, per, c };
}

export function PortalBoard() {
  const { base, meta } = useCtx(); const R = useRatings(); const P = usePortal();
  const [q, setQ] = useState(''); const [worst, setWorst] = useState(false);
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, r])), [R.data]);
  if (P.loading || R.loading) return <Loading />;
  if (P.error) return <ErrorBox msg={P.error} />;
  const all = P.rows.filter((r) => byId.has(r.team_id) && (r.n_in > 0 || r.n_out > 0)).sort((a, b) => b.net - a.net);
  const rankOf = new Map(all.map((r, i) => [r.team_id, i + 1]));
  const shown = (worst ? [...all].reverse() : all).filter((r) => !q || byId.get(r.team_id)!.short_name.toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  return (
    <>
      <p className="sub">Who actually got better through the portal. Each player counts for what they produced last season, scaled for how strong their old team was. The total is how many points a game a team gained or lost.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a school" aria-label="Find a school" style={{ font: 'inherit', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--panel)', color: 'var(--ink)', minWidth: 200 }} />
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${!worst ? 'on' : ''}`} onClick={() => setWorst(false)}>Gained most</button>
          <button className={`chip ${worst ? 'on' : ''}`} onClick={() => setWorst(true)}>Lost most</button>
        </div>
      </div>
      <div className="panel">
        <ul className="pt-list">
          <li className="pt-headrow"><span /><span>Added</span><span>Lost</span><span>Net</span></li>
          {shown.map((r) => { const t = byId.get(r.team_id)!;
            return (
              <li key={r.team_id}><Link to={`${base}/transfers/${r.team_id}`}>
                <span className="pt-team"><span className="muted pt-rk">{rankOf.get(r.team_id)}</span>{t.logo_url && <img src={t.logo_url} alt="" width={30} height={30} loading="lazy" />}<span><b>{t.short_name}</b><span className="muted sm">{r.n_in} in · {r.n_out} out</span></span></span>
                <span className="num up">{r.add >= 0.05 ? `+${r.add.toFixed(1)}` : '0.0'}</span>
                <span className="num dn">{r.lose >= 0.05 ? `−${r.lose.toFixed(1)}` : '0.0'}</span>
                <b className={`num pt-net ${r.net > 0.05 ? 'up' : r.net < -0.05 ? 'dn' : ''}`}>{signed(r.net)}</b>
              </Link></li>
            ); })}
        </ul>
        {!shown.length && <p className="muted">No schools match.</p>}
      </div>
      <p className="muted sm" style={{ marginTop: 10 }}>Points a game, {meta.long.toLowerCase()}. Counts players with a game on record at both schools, so it fills in as the season starts. Freshmen and players returning from a year off are not included. Over the last four seasons this measure has tracked how teams changed far better than counting transfers, but it is an estimate: a typical team still lands several points from where any offseason number puts it.</p>
    </>
  );
}

export function PortalTeamPage() {
  const { sport, season, base, meta } = useCtx(); const { teamId } = useParams(); const id = Number(teamId);
  const R = useRatings(); const P = usePortal();
  const pl = useAsync(() => restAll<PlayerRow>(`v_portal_players?sport_id=eq.${sport}&season_year=eq.${season}&or=(from_team_id.eq.${id},to_team_id.eq.${id})&order=value.desc`), [sport, season, id]);
  const byId = useMemo(() => new Map((R.data ?? []).map((r) => [r.team_id, { name: r.short_name, logo: r.logo_url as string | null }])), [R.data]);
  const missing = useMemo(() => [...new Set((pl.data ?? []).flatMap((p) => [p.from_team_id, p.to_team_id]).filter((x): x is number => x != null && !byId.has(x)))], [pl.data, byId]);
  const extra = useAsync(() => (missing.length ? rest<{ id: number; short_name: string; logo_url: string | null }[]>(`teams?id=in.(${missing.join(',')})&select=id,short_name,logo_url`) : Promise.resolve([])), [missing.join(',')]);
  const team = (tid: number | null) => (tid == null ? null : byId.get(tid) ?? (() => { const e = (extra.data ?? []).find((x) => x.id === tid); return e ? { name: e.short_name, logo: e.logo_url } : { name: 'another school', logo: null }; })());
  const row = P.rows.find((r) => r.team_id === id);
  const current = season === SPORTS[sport].seasons[0].year;
  const b = useBracket(); const [wi, setWi] = useState<{ with: WhatIf; without: WhatIf } | null>(null);
  const netRating = row ? row.net / P.per : 0;
  useEffect(() => { if (current && row && Math.abs(netRating) >= 0.3) initBracket(sport, season); }, [current, sport, season, !!row, netRating]);
  useEffect(() => { setWi(null); if (!current || !row || Math.abs(netRating) < 0.3 || b.status !== 'ready' || b.sport !== sport) return; let live = true; ratingWhatIf(id, -netRating).then((r) => live && setWi(r)); return () => { live = false; }; }, [b.status, b.sport, id, netRating, current]);

  if (!COEF[sport]) return <><Back /><div className="panel empty"><p>Transfer tracking covers basketball for now.</p></div></>;
  if (R.loading || P.loading || pl.loading) return <><Back /><Loading /></>;
  if (pl.error || P.error) return <><Back /><ErrorBox msg={(pl.error || P.error)!} /></>;
  const me = byId.get(id); const players = pl.data ?? [];
  const came = players.filter((p) => p.status === 'moved' && p.to_team_id === id), left = players.filter((p) => p.status === 'moved' && p.from_team_id === id);
  const kept = players.filter((p) => p.status === 'kept'), gone = players.filter((p) => p.status === 'gone' && Number(p.value) > 0);
  const ranked = [...P.rows].filter((r) => byId.has(r.team_id) && (r.n_in > 0 || r.n_out > 0)).sort((x, y) => y.net - x.net); const rk = ranked.findIndex((r) => r.team_id === id) + 1;
  const net = row?.net ?? 0;
  const line = (p: PlayerRow, other: number | null, pts: number, dir: 'in' | 'out') => { const o = team(other);
    return (
      <li key={p.player_id}><Link to={`${base}/player/${p.player_id}`}>
        <span><b>{p.display_name}</b><span className="muted sm">{dir === 'in' ? 'from' : 'to'} {o?.name ?? 'another school'} · {pg(p.pts, p.gp)} pts, {pg(p.reb, p.gp)} reb, {pg(p.ast, p.gp)} ast last season</span></span>
        <b className={`num ${dir === 'in' ? 'up' : 'dn'}`}>{pts < 0.05 ? '0.0' : `${dir === 'in' ? '+' : '−'}${pts.toFixed(1)}`}</b>
      </Link></li>
    ); };
  return (
    <>
      <Back />
      <div className="pt-hero">
        {me?.logo && <img src={me.logo} alt="" width={64} height={64} />}
        <div><h1 style={{ margin: 0 }}>{me?.name ?? 'Team'} in the portal</h1>
          <div className="muted">{came.length} in · {left.length} out{rk > 0 ? ` · ${rk}${rk % 10 === 1 && rk % 100 !== 11 ? 'st' : rk % 10 === 2 && rk % 100 !== 12 ? 'nd' : rk % 10 === 3 && rk % 100 !== 13 ? 'rd' : 'th'} of ${ranked.length} in ${meta.long.toLowerCase()}` : ''}</div></div>
      </div>
      <div className="cards" style={{ marginBottom: 16 }}>
        <div className="card"><div className="k">Portal net</div><div className={`v ${net > 0.05 ? 'up' : net < -0.05 ? 'dn' : ''}`}>{signed(net)}</div><div className="r">points a game</div></div>
        <div className="card"><div className="k">Added</div><div className="v">{row && row.add >= 0.05 ? `+${row.add.toFixed(1)}` : '0.0'}</div><div className="r">{came.length} transfer{came.length === 1 ? '' : 's'} in</div></div>
        <div className="card"><div className="k">Lost to other schools</div><div className="v">{row && row.lose >= 0.05 ? `−${row.lose.toFixed(1)}` : '0.0'}</div><div className="r">{left.length} transfer{left.length === 1 ? '' : 's'} out</div></div>
        <div className="card"><div className="k">Back from last season</div><div className="v">{kept.length}</div><div className="r">player{kept.length === 1 ? '' : 's'} who have played this season</div></div>
      </div>

      {current && row && Math.abs(netRating) >= 0.3 && (
        <section className="panel pt-odds">
          <h2 style={{ marginTop: 0 }}>What the portal did to their March</h2>
          {!wi ? <p className="muted">Running the season with and without this portal class…</p> : (
            <div className="pt-odds-grid">
              {([['Make the tournament', wi.with.make, wi.without.make], ['Reach the Sweet 16', wi.with.reach[2], wi.without.reach[2]], ['Reach the Final Four', wi.with.reach[4], wi.without.reach[4]]] as [string, number, number][]).map(([k, a, z]) => (
                <div key={k}><div className="k">{k}</div><div className="pt-odds-v"><b>{pct(a)}</b><span className="muted">{net >= 0 ? 'without these moves' : 'if nobody had moved'}: {pct(z)}</span></div></div>
              ))}
            </div>
          )}
          <p className="muted sm" style={{ marginBottom: 0 }}>The second number re-runs the rest of the season with {me?.name ?? 'this team'} {net >= 0 ? 'weaker' : 'stronger'} by the portal net. Games already played stay as they went.</p>
        </section>
      )}

      <h2>Came in</h2>
      <div className="panel">{came.length ? <ul className="pt-list pt-players">{came.map((p) => line(p, p.from_team_id, P.c.in * Number(p.value_adj) * P.per, 'in'))}</ul> : <p className="muted">No transfers in with a game on record yet.</p>}</div>
      <h2>Left for another school</h2>
      <div className="panel">{left.length ? <ul className="pt-list pt-players">{left.map((p) => line(p, p.to_team_id, P.c.lost * Number(p.value) * P.per, 'out'))}</ul> : <p className="muted">Nobody from last season's team has played for another school this season.</p>}</div>
      {gone.length > 0 && (<>
        <h2>Also gone</h2>
        <div className="panel"><p className="muted sm" style={{ marginTop: 0 }}>Out of eligibility, turned pro, left the sport, or not in a game yet this season. Not counted in the portal net.</p>
          <ul className="pt-list pt-players">{gone.slice(0, 8).map((p) => <li key={p.player_id}><Link to={`${base}/player/${p.player_id}`}><span><b>{p.display_name}</b><span className="muted sm">{pg(p.pts, p.gp)} pts, {pg(p.reb, p.gp)} reb, {pg(p.ast, p.gp)} ast last season</span></span></Link></li>)}</ul></div>
      </>)}
      <p className="muted sm" style={{ marginTop: 12 }}>Each player's number is last season's production turned into points a game for this season's team, using how roster changes have played out over the last four seasons. A transfer from a stronger team counts for more than the same stat line from a weaker one. It is an estimate, not a guarantee: players improve, roles change, and freshmen are not included.</p>
    </>
  );
}
