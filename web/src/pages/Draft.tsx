import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { restAll } from '../api';
import { useAsync, useCtx, teamColor } from '../hooks';
import { Back, Loading, ErrorBox } from '../components/Shell';

// The draft board: draft-eligible players ranked by what they have produced this season.
interface Prospect { draft_year: number; rank: number; pos: string; pos_rank: number; player_id: number; team_id: number; name: string; school: string; logo_url: string | null; color: string | null; team_rank: number; class_year: string; height_in: number | null; weight_lb: number | null; games: number; line: string }
const POS: [string, string][] = [['ALL', 'Everyone'], ['QB', 'Quarterbacks'], ['RB', 'Running backs'], ['WR', 'Receivers'], ['TE', 'Tight ends'], ['DL', 'Defensive line'], ['LB', 'Linebackers'], ['DB', 'Defensive backs']];
const height = (n: number | null) => (n ? `${Math.floor(n / 12)}'${n % 12}"` : '');
const PAGE = 50;

export function DraftPage() {
  const { season } = useCtx();
  const B = useAsync(() => restAll<Prospect>('v_draft_board?order=rank'), []);
  const [pos, setPos] = useState('ALL'); const [cls, setCls] = useState('ALL'); const [q, setQ] = useState(''); const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => (B.data ?? []).filter((p) => (pos === 'ALL' || p.pos === pos) && (cls === 'ALL' || p.class_year === cls) && (!q || `${p.name} ${p.school}`.toLowerCase().includes(q.toLowerCase()))), [B.data, pos, cls, q]);
  const year = B.data?.[0]?.draft_year ?? season + 1;
  const pick = (set: (v: string) => void) => (v: string) => { set(v); setShown(PAGE); };
  return (
    <div className="draft">
      <Back />
      <h1>{year} NFL Draft board</h1>
      <p className="sub">The 400 draft-eligible college players doing the most on the field this season. It updates after every game.</p>
      <div className="chips scroll">{POS.map(([k, label]) => <button key={k} className={`chip ${pos === k ? 'on' : ''}`} onClick={() => pick(setPos)(k)}>{label}</button>)}</div>
      <div className="draft-tools">
        <div className="chips" style={{ margin: 0 }}>{[['ALL', 'All classes'], ['Junior', 'Juniors'], ['Senior', 'Seniors']].map(([k, label]) => <button key={k} className={`chip ${cls === k ? 'on' : ''}`} onClick={() => pick(setCls)(k)}>{label}</button>)}</div>
        <input className="draft-search" type="search" placeholder="Find a player or school" value={q} onChange={(e) => pick(setQ)(e.target.value)} aria-label="Find a player or school" />
      </div>
      {B.loading ? <Loading rows={10} /> : B.error ? <ErrorBox msg={B.error} /> : !rows.length ? <div className="panel empty"><p>No one on the board matches that. Try another position or clear the search.</p></div> : (
        <>
          <ol className="draft-list">
            {rows.slice(0, shown).map((p) => (
              <li key={p.player_id} style={{ ['--tc' as any]: teamColor(p.color) }}>
                <Link to={`/cfb/${season}/player/${p.player_id}`} className="draft-row">
                  <span className="draft-rk num">{pos === 'ALL' ? p.rank : p.pos_rank}</span>
                  {p.logo_url ? <img src={p.logo_url} alt="" width={44} height={44} loading="lazy" /> : <span style={{ width: 44 }} />}
                  <span className="draft-who">
                    <b>{p.name}</b>
                    <span className="muted">{p.school}, {p.class_year.toLowerCase()}{p.height_in ? `, ${height(p.height_in)}` : ''}{p.weight_lb ? ` ${p.weight_lb} lb` : ''}</span>
                    <span className="draft-line">{p.line} in {p.games} games</span>
                  </span>
                  <span className="draft-pos"><b>{p.pos}</b><span className="muted">{pos === 'ALL' ? `No. ${p.pos_rank}` : `No. ${p.rank} overall`}</span></span>
                </Link>
              </li>
            ))}
          </ol>
          {shown < rows.length && <button className="draft-more" onClick={() => setShown(shown + PAGE)}>Show the next {Math.min(PAGE, rows.length - shown)}</button>}
        </>
      )}
      <section className="hsec">
        <h2>How this board works</h2>
        <div className="panel draft-how">
          <p><b>It ranks production, not potential.</b> Each player is scored on what he has done per game this season, at his position, with more credit for doing it against a tougher schedule. NFL scouts also weigh size, speed and film, which this board does not see.</p>
          <p><b>Who is on it.</b> Juniors and seniors with at least five games played. Offensive linemen, kickers and punters are left off because the box score has no numbers for them.</p>
          <p><b>The order.</b> Players are ranked within their position first, then the positions are blended so the mix matches how the NFL spends its picks: more pass rushers, cornerbacks and receivers, fewer running backs and tight ends.</p>
        </div>
      </section>
    </div>
  );
}
