import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCtx, useRatings, visibleColor, useFollows } from '../hooks';
import { SPORTS, sportMeta } from '../sports';

// Layout. Bottom bar (phones) holds what you use every visit: Home, Scores across all sports, Sports, Search.
// Inside a sport, a row of tabs under the header moves between that sport's sections, like a league page in
// FotMob or ESPN.
export function Shell({ children }: { children: ReactNode }) {
  const { sport, season, base, meta, inSport } = useCtx();
  const loc = useLocation();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<null | 'sport' | 'search'>(null);
  useEffect(() => { window.scrollTo(0, 0); setSheet(null); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const rest = loc.pathname.split('/').slice(3).join('/');
  const swap = (s: string, y0: number) => {
    const m = sportMeta(s);
    const y = m.seasons.some((x) => x.year === y0) ? y0 : m.seasons[0].year;
    const keep = /^(today|rankings|stats|matchup|ballot|tournament|transfers)?$/.test(rest) ? rest : '';
    nav(`/${s}/${y}${keep ? '/' + keep : ''}`);
  };
  const tabs = [
    { to: base, t: 'Overview', end: true }, { to: `${base}/rankings`, t: 'Rankings' }, { to: `${base}/today`, t: 'Scores' },
    { to: `${base}/stats`, t: 'Stats' },
    ...(meta.tourney ? [{ to: `${base}/tournament`, t: 'Tournament' }] : []),
    ...(meta.hoops ? [{ to: `${base}/transfers`, t: 'Transfers' }] : []),
    { to: `${base}/matchup`, t: 'Matchup' }, { to: `${base}/ballot`, t: 'Your Top 25' },
  ];
  const onHome = loc.pathname === '/';
  const onScores = loc.pathname === '/scores';
  const lastSport = (() => { try { return localStorage.getItem('lastSport'); } catch { return null; } })();
  useEffect(() => { if (inSport) try { localStorage.setItem('lastSport', sport); } catch { /* */ } }, [inSport, sport]);

  return (
    <>
      <header className="top">
        <div className="top-in">
          {inSport ? (
            <button className="sportbtn" onClick={() => setSheet(sheet === 'sport' ? null : 'sport')} aria-haspopup="dialog" aria-expanded={sheet === 'sport'}>
              <b>{meta.short}</b><span className="muted">{meta.seasons.find((x) => x.year === season)?.label}</span><i>▾</i>
            </button>
          ) : <Link to="/" className="brand"><i />Ratings Lab</Link>}
          <nav className="nav desk">
            <NavLink end to="/">Home</NavLink>
            <NavLink end to="/scores">Scores</NavLink>
            {Object.values(SPORTS).map((s) => <NavLink key={s.id} to={`/${s.id}/${s.seasons[0].year}`} className={() => (inSport && sport === s.id ? 'active' : '')}>{s.short}</NavLink>)}
          </nav>
          <div className="desk"><TeamSearch /></div>
          <button className="iconbtn phone" onClick={() => setSheet('search')} aria-label="Find a team">⌕</button>
        </div>
        {inSport && (
          <nav className="subtabs" aria-label={`${meta.long} sections`}>
            {tabs.map((t) => <NavLink key={t.to} end={!!t.end} to={t.to}>{t.t}</NavLink>)}
          </nav>
        )}
      </header>

      {sheet === 'sport' && (
        <Sheet onClose={() => setSheet(null)} title="Sports">
          <div className="sheet-list">
            {Object.values(SPORTS).map((s) => (
              <button key={s.id} className={`sheet-row ${inSport && sport === s.id ? 'on' : ''}`} onClick={() => { if (inSport) swap(s.id, season); else nav(`/${s.id}/${s.seasons[0].year}`); setSheet(null); }}>{s.long}</button>
            ))}
          </div>
          {inSport && meta.seasons.length > 1 && (
            <>
              <h4>Season</h4>
              <div className="sheet-grid">
                {meta.seasons.map((x) => <button key={x.year} className={`sheet-opt ${season === x.year ? 'on' : ''}`} onClick={() => { swap(sport, x.year); setSheet(null); }}>{x.label}</button>)}
              </div>
            </>
          )}
          <h4>Also</h4>
          <div className="sheet-list">
            <Link to="/record" className="sheet-row">How good are our picks?</Link>
            <Link to="/about" className="sheet-row">How the ratings work</Link>
          </div>
        </Sheet>
      )}
      {sheet === 'search' && (
        <Sheet onClose={() => setSheet(null)} title="Find a team"><TeamSearch autoFocus big /></Sheet>
      )}

      <main>{children}</main>

      <nav className="tabs phone" aria-label="Main">
        <NavLink end to="/" className={onHome ? 'active' : ''}><Icon d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />Home</NavLink>
        <NavLink end to="/scores" className={onScores ? 'active' : ''}><Icon d="M4 5h16v14H4zM4 9h16M8 3v4M16 3v4" />Scores</NavLink>
        <button className={inSport ? 'active' : ''} onClick={() => setSheet(sheet === 'sport' ? null : 'sport')}><Icon d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />{inSport ? meta.short.replace("'s hoops", "'s").replace('Football', 'Football') : 'Sports'}</button>
        <button onClick={() => setSheet('search')}><Icon d="M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4" />Search</button>
      </nav>
      {void lastSport}
    </>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h3>{title}</h3><button className="iconbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

function TeamSearch({ autoFocus, big }: { autoFocus?: boolean; big?: boolean }) {
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
    if (autoFocus) ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [autoFocus]);
  return (
    <div className={`search ${big ? 'big' : ''}`}>
      <input ref={ref} value={q} placeholder={big ? 'Team name' : 'Find a team'} aria-label="Find a team"
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
      {big && !q && <FollowedList />}
    </div>
  );
}

function FollowedList() {
  const { list } = useFollows();
  if (!list.length) return <p className="muted sm" style={{ marginTop: 14 }}>Teams you follow show up here. Open any team and tap the star.</p>;
  return (
    <div className="sheet-list" style={{ marginTop: 14 }}>
      {list.map((f) => <Link key={`${f.sport}:${f.team_id}`} to={`/${f.sport}/${f.season}/team/${f.team_id}`} className="sheet-row">{f.logo && <img src={f.logo} alt="" width={22} height={22} />}<b>{f.name}</b><span className="muted sm">{sportMeta(f.sport).short}</span></Link>)}
    </div>
  );
}

export function FollowButton({ sport, season, team_id, name, logo }: { sport: string; season: number; team_id: number; name: string; logo: string | null }) {
  const { has, toggle } = useFollows();
  const on = has(sport, team_id);
  return (
    <button className={`follow ${on ? 'on' : ''}`} onClick={() => toggle({ sport, season, team_id, name, logo })} aria-pressed={on} aria-label={on ? `Unfollow ${name}` : `Follow ${name}`}>
      <span className="star">{on ? '★' : '☆'}</span>{on ? 'Following' : 'Follow'}
    </button>
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
      <span className="swatch" style={{ background: color ? visibleColor(color) : 'var(--rule)' }} />
      {logo ? <img src={logo} alt="" loading="lazy" /> : null}
      <b>{name}</b>{sub ? <span className="muted sm">{sub}</span> : null}
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return <svg className="ic" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
