import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCtx, useRatings, visibleColor, useFollows } from '../hooks';
import { SPORTS, sportMeta } from '../sports';

// Layout: one-row header (sport, search) and, on phones, a bottom tab bar like a native app. Season lives in the
// sport sheet. The menu has four things; everything else is under More.
export function Shell({ children }: { children: ReactNode }) {
  const { sport, season, base, meta } = useCtx();
  const loc = useLocation();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<null | 'sport' | 'more' | 'search'>(null);
  useEffect(() => { window.scrollTo(0, 0); setSheet(null); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const swap = (s: string, y0: number) => {
    const m = sportMeta(s);
    const y = m.seasons.some((x) => x.year === y0) ? y0 : m.seasons[0].year;
    const rest = loc.pathname.split('/').slice(3).join('/');
    const keep = /^(today|scores|matchup|ballot|tournament|transfers|leaders)?$/.test(rest) ? rest : '';
    nav(`/${s}/${y}${keep ? '/' + keep : ''}`);
  };
  const onToday = /\/(today|scores)$/.test(loc.pathname);
  const onRank = /^\/[a-z]+\/\d+$/.test(loc.pathname);
  const more = [
    { to: `${base}/matchup`, t: 'Matchup' }, { to: `${base}/leaders`, t: 'Leaders' },
    ...(meta.tourney ? [{ to: `${base}/tournament`, t: 'Tournament odds' }] : []),
    ...(meta.hoops ? [{ to: `${base}/transfers`, t: 'Transfers' }] : []),
    { to: `${base}/ballot`, t: 'Your Top 25' }, { to: '/record', t: 'Track record' }, { to: '/about', t: 'How the numbers work' },
  ];
  const moreOn = more.some((m) => loc.pathname === m.to);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <button className="sportbtn" onClick={() => setSheet(sheet === 'sport' ? null : 'sport')} aria-haspopup="dialog" aria-expanded={sheet === 'sport'}>
            <b>{meta.short}</b><span className="muted">{meta.seasons.find((x) => x.year === season)?.label}</span><i>▾</i>
          </button>
          <nav className="nav desk">
            <NavLink to={`${base}/today`}>Today</NavLink>
            <NavLink end to={base}>Rankings</NavLink>
            {more.map((m) => <NavLink key={m.to} to={m.to}>{m.t}</NavLink>)}
          </nav>
          <div className="desk"><TeamSearch /></div>
          <button className="iconbtn phone" onClick={() => setSheet('search')} aria-label="Find a team">⌕</button>
        </div>
      </header>

      {sheet === 'sport' && (
        <Sheet onClose={() => setSheet(null)} title="Sport and season">
          <div className="sheet-grid">
            {Object.values(SPORTS).map((s) => (
              <button key={s.id} className={`sheet-opt ${sport === s.id ? 'on' : ''}`} onClick={() => { swap(s.id, season); setSheet(null); }}>{s.long}</button>
            ))}
          </div>
          {meta.seasons.length > 1 && (
            <>
              <h4>Season</h4>
              <div className="sheet-grid">
                {meta.seasons.map((x) => <button key={x.year} className={`sheet-opt ${season === x.year ? 'on' : ''}`} onClick={() => { swap(sport, x.year); setSheet(null); }}>{x.label}</button>)}
              </div>
            </>
          )}
        </Sheet>
      )}
      {sheet === 'more' && (
        <Sheet onClose={() => setSheet(null)} title="More">
          <div className="sheet-list">{more.map((m) => <Link key={m.to} to={m.to} className="sheet-row">{m.t}</Link>)}</div>
        </Sheet>
      )}
      {sheet === 'search' && (
        <Sheet onClose={() => setSheet(null)} title="Find a team"><TeamSearch autoFocus big /></Sheet>
      )}

      <main>{children}</main>

      <nav className="tabs phone" aria-label="Main">
        <NavLink to={`${base}/today`} className={onToday ? 'active' : ''}><span className="ic">◷</span>Today</NavLink>
        <NavLink end to={base} className={onRank ? 'active' : ''}><span className="ic">☰</span>Rankings</NavLink>
        <button onClick={() => setSheet('search')}><span className="ic">⌕</span>Search</button>
        <button className={moreOn ? 'active' : ''} onClick={() => setSheet(sheet === 'more' ? null : 'more')}><span className="ic">⋯</span>More</button>
      </nav>
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
      <input ref={ref} value={q} placeholder={big ? 'Team name' : 'Find a team  /'} aria-label="Find a team"
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
