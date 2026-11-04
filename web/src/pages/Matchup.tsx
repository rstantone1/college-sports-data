import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCtx, useRatings, distinctPair } from '../hooks';
import { Loading, ErrorBox } from '../components/Shell';
import { predict, league, pct, f1, perGame } from '../model';
import type { Rating } from '../api';

export function MatchupPage() {
  const { sport, base, meta } = useCtx();
  const { data, error, loading } = useRatings();
  const [sp, setSp] = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(0.5);

  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => a.short_name.localeCompare(b.short_name)), [data]);
  const a = data?.find((r) => r.team_id === Number(sp.get('a'))) ?? data?.[0];
  const b = data?.find((r) => r.team_id === Number(sp.get('b'))) ?? data?.[1];
  const site = (Number(sp.get('site') ?? 0) as 1 | 0 | -1);
  const L = useMemo(() => league(data ?? []), [data]);
  const p = a && b ? predict(a, b, L, site, sport) : null;

  // Animate the bar from 50/50 to the answer each time the matchup changes.
  useEffect(() => { setShown(0.5); const t = setTimeout(() => setShown(p?.aWin ?? .5), 60); return () => clearTimeout(t); }, [p?.aWin]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (!a || !b || !p) return <div className="panel empty">Not enough teams rated yet.</div>;

  const set = (k: string, v: string | number) => { const n = new URLSearchParams(sp); n.set(k, String(v)); setSp(n, { replace: true }); };
  const random = () => {
    const pool = data!.slice(0, 80);
    const i = Math.floor(Math.random() * pool.length); let j = Math.floor(Math.random() * pool.length); if (j === i) j = (j + 1) % pool.length;
    const n = new URLSearchParams(sp); n.set('a', String(pool[i].team_id)); n.set('b', String(pool[j].team_id)); n.set('site', '0'); setSp(n, { replace: true });
  };
  const [ca, cb] = distinctPair(a.color, b.color, b.alt_color);
  const fav = p.aWin >= .5 ? a : b, favP = Math.max(p.aWin, 1 - p.aWin), spread = Math.abs(p.margin);

  const Pick = ({ r, k }: { r: Rating; k: 'a' | 'b' }) => (
    <div className="picker panel" style={{ borderTop: `6px solid ${k === 'a' ? ca : cb}` }}>
      <select value={r.team_id} onChange={(e) => set(k, e.target.value)} aria-label={k === 'a' ? 'First team' : 'Second team'}>
        {sorted.map((t) => <option key={t.team_id} value={t.team_id}>{t.short_name} (#{t.rank})</option>)}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        {r.logo_url && <img src={r.logo_url} alt="" width={64} height={64} style={{ objectFit: 'contain' }} />}
        <div>
          <Link to={`${base}/team/${r.team_id}`} style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 28 }}>{r.short_name}</Link>
          <div className="muted sm">#{r.rank} · {r.conference_short} · Off #{r.off_rank} · Def #{r.def_rank}</div>
        </div>
      </div>
    </div>
  );

  const edge = (label: string, av: number, bv: number, lowerBetter = false) => {
    const aBetter = lowerBetter ? av < bv : av > bv;
    return (
      <tr>
        <td style={{ textAlign: 'right', fontWeight: aBetter ? 800 : 500, color: aBetter ? ca : 'inherit' }} className="num">{av.toFixed(meta.hoops ? 1 : 2)}</td>
        <td style={{ textAlign: 'center' }} className="muted sm">{label}</td>
        <td style={{ fontWeight: !aBetter ? 800 : 500, color: !aBetter ? cb : 'inherit' }} className="num">{bv.toFixed(meta.hoops ? 1 : 2)}</td>
      </tr>
    );
  };

  return (
    <>
      <h1>Matchup machine</h1>
      <p className="sub">Pick any two teams and a court. The model gives you a score, a spread and the odds, based on how both teams have played against everyone else.</p>
      <div className="mu">
        <Pick r={a} k="a" />
        <div className="vs">vs</div>
        <Pick r={b} k="b" />
      </div>

      <div className="chips" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button className={`chip ${site === 1 ? 'on' : ''}`} onClick={() => set('site', 1)}>At {a.short_name}</button>
        <button className={`chip ${site === 0 ? 'on' : ''}`} onClick={() => set('site', 0)}>Neutral court</button>
        <button className={`chip ${site === -1 ? 'on' : ''}`} onClick={() => set('site', -1)}>At {b.short_name}</button>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="score">
          <span className="s" style={{ color: ca }}>{meta.hoops || sport === 'cfb' ? Math.round(p.aPts) : p.aPts.toFixed(1)}</span>
          <span className="muted" style={{ fontSize: 28 }}>–</span>
          <span className="s" style={{ color: cb }}>{meta.hoops || sport === 'cfb' ? Math.round(p.bPts) : p.bPts.toFixed(1)}</span>
        </div>
        <div className="prob">
          <div style={{ flexBasis: `${shown * 100}%`, background: ca }}>{a.abbreviation} {pct(p.aWin)}</div>
          <div style={{ flexBasis: `${(1 - shown) * 100}%`, background: cb, justifyContent: 'flex-end' }}>{pct(1 - p.aWin)} {b.abbreviation}</div>
        </div>
        <p style={{ textAlign: 'center', fontSize: 18, margin: '0 0 6px' }}>
          <b>{fav.short_name}</b> by {spread.toFixed(1)} {meta.pointWord}, wins {pct(favP)} of the time.
          {favP > .97 ? ' Not close.' : favP < .58 ? ' Coin flip.' : ''}
        </p>
        {meta.hoops && <p className="muted sm" style={{ textAlign: 'center' }}>About {Math.round(p.poss)} possessions each.</p>}

        <table style={{ margin: '16px auto 0', borderCollapse: 'collapse' }}>
          <tbody>
            {edge('Rating', perGame(a, sport).rating, perGame(b, sport).rating)}
            {edge('Offense / game', perGame(a, sport).off, perGame(b, sport).off)}
            {edge('Defense / game', perGame(a, sport).def, perGame(b, sport).def, true)}
            {meta.hoops && edge('Pace', a.tempo, b.tempo)}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => { const n = new URLSearchParams(sp); n.set('a', String(b.team_id)); n.set('b', String(a.team_id)); n.set('site', String(-site)); setSp(n, { replace: true }); }}>Swap sides</button>
          <button className="btn ghost" onClick={random}>Surprise me</button>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>{copied ? 'Link copied' : 'Copy link'}</button>
        </div>
      </div>
    </>
  );
}
