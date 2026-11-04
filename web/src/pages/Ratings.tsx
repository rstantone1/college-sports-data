import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { previousRanks } from '../api';
import { useAsync, useCtx, useRatings, teamColor } from '../hooks';
import { Loading, ErrorBox, TeamCell } from '../components/Shell';
import { f1, sign } from '../model';

type Key = 'rank' | 'adj_em' | 'adj_off' | 'adj_def' | 'tempo' | 'games_played';

export function RatingsPage() {
  const { sport, season, base, meta } = useCtx();
  const { data, error, loading } = useRatings();
  const asOf = data?.[0]?.as_of;
  const prev = useAsync(() => (asOf ? previousRanks(sport, season, asOf) : Promise.resolve(new Map<number, number>())), [sport, season, asOf]);
  const [conf, setConf] = useState<string>('All');
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'rank', dir: 1 });
  const nav = useNavigate();

  const confs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) if (r.conference_short) m.set(r.conference_short, (m.get(r.conference_short) ?? 0) + r.adj_em);
    const counts = new Map<string, number>();
    for (const r of data ?? []) if (r.conference_short) counts.set(r.conference_short, (counts.get(r.conference_short) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => [k, v / counts.get(k)!] as const).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const rows = useMemo(() => {
    let rs = (data ?? []).filter((r) => conf === 'All' || r.conference_short === conf);
    const { k, dir } = sort;
    rs = [...rs].sort((a, b) => ((a[k] as number) - (b[k] as number)) * dir);
    return rs;
  }, [data, conf, sort]);

  if (loading) return <Loading rows={14} />;
  if (error) return <ErrorBox msg={error} />;
  if (!data?.length) return (
    <div className="panel empty">
      <h2>No ratings yet for this season</h2>
      <p>Ratings appear after the first games are processed. The data refreshes every three hours.</p>
    </div>
  );

  const minEm = Math.min(...data.map((r) => r.adj_em)), maxEm = Math.max(...data.map((r) => r.adj_em));
  const avgGp = data.reduce((a, r) => a + r.games_played, 0) / data.length;
  const th = (k: Key, label: string, cls = '') => (
    <th className={`${cls} ${sort.k === k ? 'sorted' : ''}`}
      onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : (k === 'rank' || k === 'adj_def' ? 1 : -1) }))}>
      {label}{sort.k === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  const dp = meta.hoops ? 1 : 2;

  return (
    <>
      <h1>{meta.long} ratings</h1>
      <p className="sub">
        Every Division I team, adjusted for opponent and venue. Margin is how many {meta.pointWord} better than an average team a team is, in {meta.effLabel}.
        Updated {asOf ? new Date(asOf + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : ''}.
        {avgGp < 6 && <> <b>Early season:</b> teams have about {avgGp.toFixed(1)} games, so ratings lean on last season until more games are played.</>}
      </p>

      <div className="chips scroll" role="group" aria-label="Conference">
        <button className={`chip ${conf === 'All' ? 'on' : ''}`} onClick={() => setConf('All')}>All {data.length}</button>
        {confs.map(([c]) => (
          <button key={c} className={`chip ${conf === c ? 'on' : ''}`} onClick={() => setConf(c)}>{c}</button>
        ))}
      </div>
      {conf !== 'All' && (() => {
        const id = data.find((r) => r.conference_short === conf)?.conference_id;
        return id ? <p className="sm"><Link to={`${base}/conf/${id}`} style={{ color: 'var(--cool)', fontWeight: 600 }}>Open the {conf} page</Link></p> : null;
      })()}

      <div className="panel">
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                {th('rank', '#')}
                <th className="l">Team</th>
                <th className="l hide-sm">Conf</th>
                {th('games_played', 'GP', 'hide-sm')}
                {th('adj_em', 'Margin')}
                <th className="hide-sm" style={{ cursor: 'default' }}></th>
                {th('adj_off', 'Offense')}
                {th('adj_def', 'Defense')}
                {meta.hoops && th('tempo', 'Pace', 'hide-sm')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const before = prev.data?.get(r.team_id);
                const mv = before ? before - r.rank : 0;
                const pos = (r.adj_em - minEm) / (maxEm - minEm || 1);
                return (
                  <tr key={r.team_id} className="row" onClick={() => nav(`${base}/team/${r.team_id}`)}>
                    <td className="rk">{r.rank}{mv !== 0 && <span className={`mv ${mv > 0 ? 'up' : 'dn'}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</span>}</td>
                    <td className="l"><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></td>
                    <td className="l hide-sm muted">{r.conference_short}</td>
                    <td className="hide-sm num">{r.games_played}</td>
                    <td className="num" style={{ fontSize: 18, color: r.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(r.adj_em, dp)}</td>
                    <td className="hide-sm" style={{ width: 110 }}>
                      <div className="bar"><span style={{ left: 0, width: `${Math.max(4, pos * 100)}%`, background: teamColor(r.color) }} /></div>
                    </td>
                    <td className="num">{dp === 1 ? f1(r.adj_off) : r.adj_off.toFixed(2)} <span className="muted sm">{r.off_rank}</span></td>
                    <td className="num">{dp === 1 ? f1(r.adj_def) : r.adj_def.toFixed(2)} <span className="muted sm">{r.def_rank}</span></td>
                    {meta.hoops && <td className="hide-sm num">{f1(r.tempo)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span>Offense: {meta.pointWord} scored ({meta.effLabel}) vs. an average defense (higher is better)</span>
          <span>Defense: {meta.pointWord} allowed (lower is better)</span>
          {meta.hoops && <span>Pace: possessions per 40 minutes</span>}
          <span>Small number: national rank</span>
        </div>
      </div>
    </>
  );
}
