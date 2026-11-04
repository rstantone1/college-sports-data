import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCtx, useRatings, useLocal } from '../hooks';
import { Loading, ErrorBox } from '../components/Shell';

// Build your own Top 25 and see how far it is from the model.
export function BallotPage() {
  const { sport, season, base } = useCtx();
  const { data, error, loading } = useRatings();
  const [ids, setIds] = useLocal<number[]>(`ballot:${sport}:${season}`, []);
  const [adding, setAdding] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const byId = useMemo(() => new Map((data ?? []).map((r) => [r.team_id, r])), [data]);
  const ballot = ids.filter((i) => byId.has(i));

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (!data?.length) return <div className="panel empty">No ratings yet this season.</div>;

  const start = () => setIds(data.slice(0, 25).map((r) => r.team_id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ballot.length || from === to) return;
    const n = [...ballot]; const [x] = n.splice(from, 1); n.splice(to, 0, x); setIds(n);
  };
  const remove = (i: number) => setIds(ballot.filter((_, j) => j !== i));
  const add = (teamId: number) => { if (!ballot.includes(teamId) && ballot.length < 25) setIds([...ballot, teamId]); setAdding(''); };

  // Agreement: 100 minus average rank distance (capped), so identical = 100.
  const dist = ballot.map((t, i) => Math.min(Math.abs(byId.get(t)!.rank - (i + 1)), 30));
  const agree = ballot.length ? Math.max(0, Math.round(100 - (dist.reduce((a, b) => a + b, 0) / ballot.length) * (100 / 30))) : 0;
  const boldest = ballot.map((t, i) => ({ r: byId.get(t)!, you: i + 1, gap: byId.get(t)!.rank - (i + 1) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 3).filter((x) => x.gap !== 0);
  const snubs = data.slice(0, 25).filter((r) => !ballot.includes(r.team_id)).slice(0, 5);
  const options = data.filter((r) => !ballot.includes(r.team_id)).sort((a, b) => a.short_name.localeCompare(b.short_name));

  return (
    <>
      <h1>Your Top 25</h1>
      <p className="sub">Rank them your way. Drag rows or use the arrows. Your ballot stays on this device, and we score how far you are from the model.</p>
      {!ballot.length ? (
        <div className="panel empty">
          <p>Start from the model's Top 25 and shuffle it, or build one from scratch.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn" onClick={start}>Start from the model</button>
            <button className="btn ghost" onClick={() => setIds([data[0].team_id])}>Start from scratch</button>
          </div>
        </div>
      ) : (
        <div className="grid g2">
          <div>
            <ol className="ballot">
              {ballot.map((t, i) => {
                const r = byId.get(t)!; const gap = r.rank - (i + 1);
                return (
                  <li key={t} draggable className={dragging === i ? 'drag' : ''}
                    onDragStart={() => { dragFrom.current = i; setDragging(i); }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragFrom.current != null) move(dragFrom.current, i); dragFrom.current = null; setDragging(null); }}
                    style={{ borderLeft: `5px solid #${r.color ?? '999'}` }}>
                    <span className="bn">{i + 1}</span>
                    <span className="team">{r.logo_url && <img src={r.logo_url} alt="" />}<Link to={`${base}/team/${t}`}><b>{r.short_name}</b></Link>
                      <span className="muted sm">model #{r.rank}{gap !== 0 && <span className={gap > 0 ? 'W' : 'L'}> ({gap > 0 ? '+' : ''}{gap})</span>}</span></span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button className="mini" aria-label="Move up" onClick={() => move(i, i - 1)}>↑</button>
                      <button className="mini" aria-label="Move down" onClick={() => move(i, i + 1)}>↓</button>
                    </span>
                    <button className="mini" aria-label="Remove" onClick={() => remove(i)}>✕</button>
                  </li>
                );
              })}
            </ol>
            {ballot.length < 25 && (
              <select value={adding} onChange={(e) => add(Number(e.target.value))} style={{ marginTop: 10, width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--panel)', color: 'var(--ink)', font: 'inherit', fontWeight: 600 }}>
                <option value="">Add a team ({25 - ballot.length} spots left)</option>
                {options.map((r) => <option key={r.team_id} value={r.team_id}>{r.short_name} (#{r.rank})</option>)}
              </select>
            )}
          </div>
          <div className="grid" style={{ alignContent: 'start' }}>
            <div className="panel" style={{ textAlign: 'center' }}>
              <div className="muted">Agreement with the model</div>
              <div className="muted sm">100 means your order matches the ratings exactly</div>
              <div className="agree" style={{ color: agree > 80 ? 'var(--win)' : agree > 55 ? 'var(--gold)' : 'var(--hot)' }}>{agree}</div>
              <div className="muted sm">{agree > 90 ? 'You and the math are in sync.' : agree > 70 ? 'Mostly aligned, a few strong opinions.' : agree > 50 ? 'You see things the numbers don\'t.' : 'Bold. Very bold.'}</div>
            </div>
            {boldest.length > 0 && (
              <div className="panel">
                <h3>Your boldest calls</h3>
                {boldest.map((x) => (
                  <p key={x.r.team_id} style={{ margin: '0 0 6px' }}><b>{x.r.short_name}</b>: you have them #{x.you}, model #{x.r.rank}. {x.gap > 0 ? 'Higher than the numbers.' : 'Lower than the numbers.'}</p>
                ))}
              </div>
            )}
            {snubs.length > 0 && (
              <div className="panel">
                <h3>Model Top 25 teams you left out</h3>
                {snubs.map((r) => <p key={r.team_id} style={{ margin: '0 0 4px' }}>#{r.rank} {r.short_name} <button className="chip" onClick={() => add(r.team_id)} disabled={ballot.length >= 25}>Add</button></p>)}
              </div>
            )}
            <button className="btn ghost" onClick={() => setIds([])}>Clear my ballot</button>
          </div>
        </div>
      )}
    </>
  );
}
