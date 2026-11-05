import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { previousRanks } from '../api';
import { useAsync, useCtx, useRatings, visibleColor } from '../hooks';
import { Loading, ErrorBox, TeamCell } from '../components/Shell';
import { f1, sign, perGame } from '../model';

type Key = 'rank' | 'adj_em' | 'adj_off' | 'adj_def' | 'tempo' | 'games_played';

export function RatingsPage() {
  const { sport, season, base, meta } = useCtx();
  const { data, error, loading } = useRatings();
  const asOf = data?.[0]?.as_of;
  const prev = useAsync(() => (asOf ? previousRanks(sport, season, asOf) : Promise.resolve(new Map<number, number>())), [sport, season, asOf]);
  const [conf, setConf] = useState<string>('All');
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'rank', dir: 1 });
  const [adv, setAdv] = useState(false);
  const [showKey, setShowKey] = useState(false);
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
  const dp = adv && !meta.hoops ? 2 : 1;
  const ex = data[0], exPg = perGame(ex, sport);

  return (
    <>
      <h1>{meta.long} ratings</h1>
      <p className="sub">
        Every Division I team, ranked by how many {meta.pointWord} better than an average team they'd be on a neutral court, after adjusting for who they played and where.
        Updated {asOf ? new Date(asOf + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : ''}.
        {avgGp < 6 && <> <b>Early season:</b> {avgGp < 1.5 ? 'most teams have played one game' : `teams have played about ${Math.round(avgGp)} games`}, so ratings still lean on last season.</>}
      </p>

      <div className="chips" style={{ gap: 8 }}>
        <button className={`chip ${!adv ? 'on' : ''}`} onClick={() => setAdv(false)}>Simple</button>
        <button className={`chip ${adv ? 'on' : ''}`} onClick={() => setAdv(true)}>Advanced</button>
        <button className="back" style={{ margin: '0 0 0 6px', textDecoration: 'underline', color: 'var(--cool)' }} onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide key' : 'What do these numbers mean?'}</button>
      </div>
      {showKey && (
        <div className="panel" style={{ marginBottom: 12, maxWidth: 720 }}>
          <p><b>Rating</b> is the whole story in one number: how many {meta.pointWord} this team would beat an average Division I team by, on a neutral court, in a typical game. +10 means a 10-{meta.pointWord.replace(/s$/, '')} favorite against an average team. Teams above zero are better than average.</p>
          <p><b>Scores</b> is {meta.pointWord} they'd put up in a typical game against an average defense. <b>Allows</b> is {meta.pointWord} an average offense would score on them, so lower is better. Rating is simply Scores minus Allows. Both assume an average pace, so a fast team and a slow team are compared fairly. The small gray number is the national rank for that column.</p>
          {meta.hoops && <p><b>Pace</b> is possessions per game. Fast teams score and allow more {meta.pointWord} without being better or worse.</p>}
          <p>"Adjusted" means every game is weighed by who it was against and where it was played. Beating a top-10 team on the road counts for far more than beating a bad team at home.</p>
          <p className="muted sm" style={{ margin: 0 }}>Advanced view shows the same numbers per {meta.hoops ? '100 possessions' : sport === 'cfb' ? '10 drives' : `${meta.scale} innings`}, which is how analysts compare teams that play at different speeds.</p>
        </div>
      )}
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
                {th('adj_em', 'Rating')}
                <th className="hide-sm" style={{ cursor: 'default' }}></th>
                {th('adj_off', adv ? 'Offense' : 'Scores')}
                {th('adj_def', adv ? 'Defense' : 'Allows')}
                {meta.hoops && th('tempo', 'Pace', 'hide-sm')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const before = prev.data?.get(r.team_id);
                const mv = before ? before - r.rank : 0;
                const pos = (r.adj_em - minEm) / (maxEm - minEm || 1);
                const pg = perGame(r, sport);
                const show = adv ? { em: r.adj_em, o: r.adj_off, d: r.adj_def } : { em: pg.rating, o: pg.off, d: pg.def };
                return (
                  <tr key={r.team_id} className="row" onClick={() => nav(`${base}/team/${r.team_id}`)}>
                    <td className="rk">{r.rank}{mv !== 0 && <span className={`mv ${mv > 0 ? 'up' : 'dn'}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</span>}</td>
                    <td className="l"><TeamCell name={r.short_name} logo={r.logo_url} color={r.color} /></td>
                    <td className="l hide-sm muted">{r.conference_short}</td>
                    <td className="hide-sm num">{r.games_played}</td>
                    <td className="num big" style={{ color: r.adj_em >= 0 ? 'var(--win)' : 'var(--hot)' }}>{sign(show.em, dp)}</td>
                    <td className="hide-sm" style={{ width: 110 }}>
                      <div className="bar"><span style={{ left: 0, width: `${Math.max(4, pos * 100)}%`, background: visibleColor(r.color) }} /></div>
                    </td>
                    <td className="num">{show.o.toFixed(dp)} <span className="muted sm hide-sm">{r.off_rank}</span></td>
                    <td className="num">{show.d.toFixed(dp)} <span className="muted sm hide-sm">{r.def_rank}</span></td>
                    {meta.hoops && <td className="hide-sm num">{f1(r.tempo)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {adv ? (
          <div className="legend">
            <span>Rating, Offense, Defense: {meta.effLabel}, adjusted for opponents and venue</span>
            {meta.hoops && <span>Pace: possessions per game</span>}
            <span>Small number: national rank</span>
          </div>
        ) : (
          <p className="muted sm" style={{ margin: '10px 0 0' }}>
            How to read a row: <b>{ex.short_name} {sign(exPg.rating, dp)}</b> means they'd beat an average team by about {Math.abs(exPg.rating).toFixed(meta.hoops ? 0 : 1)} {meta.pointWord} a game,
            scoring {exPg.off.toFixed(dp)} and allowing {exPg.def.toFixed(dp)}.<span className="hide-sm"> The small gray number is where that offense or defense ranks nationally.</span>
          </p>
        )}
      </div>
    </>
  );
}
