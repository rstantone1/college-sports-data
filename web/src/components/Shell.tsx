import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCtx, useRatings } from '../hooks';

export function Shell({ children }: { children: ReactNode }) {
  const { sport, season, base } = useCtx();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  const swap = (s: string, y: number) => {
    const rest = loc.pathname.split('/').slice(3).join('/');
    const keep = /^(scores|matchup|ballot)?$/.test(rest) ? rest : '';
    nav(`/${s}/${y}${keep ? '/' + keep : ''}`);
  };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link to={base} className="brand"><i />Tilt</Link>
          <div className="seg" role="group" aria-label="Sport">
            <button className={sport === 'mbb' ? 'on' : ''} onClick={() => swap('mbb', season)}>Men</button>
            <button className={sport === 'wbb' ? 'on' : ''} onClick={() => swap('wbb', season)}>Women</button>
          </div>
          <div className="seg" role="group" aria-label="Season">
            <button className={season === 2027 ? 'on' : ''} onClick={() => swap(sport, 2027)}>2026-27</button>
            <button className={season === 2026 ? 'on' : ''} onClick={() => swap(sport, 2026)}>2025-26</button>
          </div>
          <TeamSearch />
          <nav className="nav">
            <NavLink end to={base}>Ratings</NavLink>
            <NavLink to={`${base}/scores`}>Scores</NavLink>
            <NavLink to={`${base}/matchup`}>Matchup</NavLink>
            <NavLink to={`${base}/ballot`}>Your Top 25</NavLink>
            <NavLink to="/about">How it works</NavLink>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}

function TeamSearch() {
  const { base } = useCtx();
  const { data } = useRatings();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return [];
    return data.filter((r) => `${r.display_name} ${r.abbreviation} ${r.conference_short ?? ''}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, data]);
  const go = (id: number) => { setQ(''); ref.current?.blur(); nav(`${base}/team/${id}`); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="search">
      <input ref={ref} value={q} placeholder="Find a team  /" aria-label="Find a team"
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && hits[hi]) go(hits[hi].team_id);
          if (e.key === 'Escape') setQ('');
        }} />
      {hits.length > 0 && (
        <ul>
          {hits.map((r, i) => (
            <li key={r.team_id}><a href="#" className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); go(r.team_id); }}>
              {r.logo_url && <img src={r.logo_url} alt="" width={20} height={20} />}
              <span><b>{r.short_name}</b> <span className="muted sm">#{r.rank} · {r.conference_short}</span></span>
            </a></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Back() {
  const nav = useNavigate();
  return <button className="back" onClick={() => nav(-1)}>← Back</button>;
}

export function Loading({ rows = 8 }: { rows?: number }) {
  return <div className="panel">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${70 + ((i * 37) % 30)}%` }} />)}</div>;
}

export function ErrorBox({ msg }: { msg: string }) {
  return <div className="panel empty">Couldn't load this. {msg}</div>;
}

export function TeamCell({ name, logo, color, sub }: { name: string; logo?: string | null; color?: string | null; sub?: string }) {
  return (
    <span className="team">
      <span className="swatch" style={{ background: color ? `#${color}` : 'var(--rule)' }} />
      {logo ? <img src={logo} alt="" loading="lazy" /> : null}
      <b>{name}</b>{sub ? <span className="muted sm">{sub}</span> : null}
    </span>
  );
}
