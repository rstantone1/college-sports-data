import { rest, toBet, type Bet, type Game } from '../api';
import { useAsync } from '../hooks';

const M = '−';
export const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const pts = (x: number) => String(Math.round(Math.abs(x) * 2) / 2);
// One side's number, the way it's said: +3.5, −2, PK.
export const sideNum = (x: number) => (x === 0 ? 'PK' : x > 0 ? `+${pts(x)}` : `${M}${pts(x)}`);
// The spread as people say it: the favorite and the points. Spread is from the home team's view.
export function lineText(spread: number | null, homeAbbr: string, awayAbbr: string) {
  if (spread == null) return null;
  if (spread === 0) return "Pick'em";
  return spread < 0 ? `${homeAbbr} ${M}${pts(spread)}` : `${awayAbbr} ${M}${pts(spread)}`;
}
// A bet in words: "Texas −2.5", "Over 142.5".
export function betText(b: Pick<Bet, 'market' | 'side' | 'line'>, homeName: string, awayName: string) {
  if (b.market === 'total') return `${b.side === 'over' ? 'Over' : 'Under'} ${pts(b.line)}`;
  if (b.market === 'moneyline') return `${b.side === 'home' ? homeName : awayName} to win`;
  return b.side === 'home' ? `${homeName} ${sideNum(b.line)}` : `${awayName} ${sideNum(-b.line)}`;
}
export const TIER: Record<string, { label: string; cls: string }> = {
  best: { label: 'Best bet', cls: 'tier best' }, strong: { label: 'Strong', cls: 'tier strong' }, lean: { label: 'Lean', cls: 'tier lean' },
};
// Did the bet win? Spread from the home view: home covers when home margin + spread > 0.
export function grade(b: Pick<Bet, 'market' | 'side' | 'line'>, hs: number, as: number): 'win' | 'loss' | 'push' {
  const x = b.market === 'total' ? (b.side === 'over' ? hs + as - b.line : b.line - (hs + as))
    : b.side === 'home' ? hs - as + b.line : -(hs - as + b.line);
  return x > 0 ? 'win' : x < 0 ? 'loss' : 'push';
}

interface BookRow { book: string; spread: number | null; total: number | null; home_ml: number | null; away_ml: number | null }
const BOOK_NAMES: Record<string, string> = { draftkings: 'DraftKings', 'espn bet': 'ESPN BET', fanduel: 'FanDuel', betmgm: 'BetMGM', caesars: 'Caesars', bovada: 'Bovada', bet365: 'bet365', fanatics: 'Fanatics', 'hard rock': 'Hard Rock', betfair: 'Betfair' };
export const bookLabel = (b: string | null) => (b ? BOOK_NAMES[b] ?? b.replace(/\b\w/g, (c) => c.toUpperCase()) : '');

// The betting line next to our number, on a game's page. Before the game: where we stand against the books and
// which book has the best number. After: how the line closed and whether our side covered.
export function LineCard({ game, ourMargin, ourTotal, pointWord }: { game: Game; ourMargin: number | null; ourTotal: number | null; pointWord: string }) {
  const id = game.id;
  const extra = useAsync(() => Promise.all([
    rest<BookRow[]>(`game_lines?game_id=eq.${id}&phase=eq.current&select=book,spread,total,home_ml,away_ml`),
    rest<any[]>(`v_bets?game_id=eq.${id}&kind=eq.live`).then((r) => r.map(toBet)),
    rest<{ margin: string; home_pts: string | null; away_pts: string | null }[]>(`predictions?game_id=eq.${id}&kind=eq.live&select=margin,home_pts,away_pts`),
  ]), [id]);
  const spread = num(game.spread), total = num(game.total), spOpen = num(game.spread_open), totOpen = num(game.total_open);
  if (spread == null && total == null) return null;
  const [books, bets, locked] = extra.data ?? [[], [], []];
  const final = game.completed && game.home_score != null;
  // Our number: the one we locked in before the game if there is one; today's ratings only before the game.
  const lockedP = locked[0];
  const bet = bets.find((b) => b.market === 'spread'), tbet = bets.find((b) => b.market === 'total');
  const m = bet ? bet.our_number : lockedP ? Number(lockedP.margin) : final ? null : ourMargin;
  const t = tbet ? tbet.our_number : lockedP?.home_pts != null ? Number(lockedP.home_pts) + Number(lockedP.away_pts) : final ? null : ourTotal;
  const H = game.home_name, A = game.away_name;
  const edge = m != null && spread != null ? m + spread : null;          // + = we like the home side more than the books
  const tEdge = t != null && total != null ? t - total : null;
  const sideName = edge == null ? '' : edge > 0 ? H : A;
  const sideLine = edge == null || spread == null ? '' : edge > 0 ? sideNum(spread) : sideNum(-spread);
  const close = (x: number | null) => x != null && Math.abs(x) < 1;
  const res = final && spread != null ? grade({ market: 'spread', side: (edge ?? 1) > 0 ? 'home' : 'away', line: spread }, game.home_score!, game.away_score!) : null;
  const tres = final && total != null && tEdge != null ? grade({ market: 'total', side: tEdge > 0 ? 'over' : 'under', line: total }, game.home_score!, game.away_score!) : null;
  // Best number for our side right now, across the books we can see.
  const shop = !final && edge != null && Math.abs(edge) >= 1 ? books.filter((b) => b.spread != null).map((b) => ({ book: b.book, v: Number(b.spread) }))
    .sort((a, b) => (edge > 0 ? b.v - a.v : a.v - b.v)) : [];
  const moved = spOpen != null && spread != null && spOpen !== spread;

  return (
    <div className="panel linecard" style={{ marginBottom: 16 }}>
      <div className="lc-head">
        <h3>The betting line</h3>
        {bet?.tier && <span className={TIER[bet.tier].cls}>{TIER[bet.tier].label}</span>}
      </div>
      <div className="lc-grid">
        <div>
          <div className="k">Sportsbooks</div>
          <div className="v">{lineText(spread, game.home_abbr, game.away_abbr) ?? '–'}</div>
          {total != null && <div className="r">Total {pts(total)}</div>}
          {(moved || (totOpen != null && totOpen !== total)) && <div className="r muted">Opened {spOpen != null ? lineText(spOpen, game.home_abbr, game.away_abbr) : ''}{totOpen != null ? `${spOpen != null ? ', ' : ''}total ${pts(totOpen)}` : ''}</div>}
        </div>
        <div>
          <div className="k">Our number</div>
          <div className="v">{m == null ? '–' : Math.abs(m) < 0.5 ? 'Even' : `${m > 0 ? game.home_abbr : game.away_abbr} by ${Math.abs(m).toFixed(1)}`}</div>
          {t != null && <div className="r">Total {t.toFixed(1)}</div>}
          {(bet || lockedP) && <div className="r muted">Locked in before the game</div>}
        </div>
      </div>
      {edge != null && spread != null && (
        <p className="lc-say">
          {close(edge) ? <>We agree with the books on this one.</>
            : <>We'd take <b>{sideName} {sideLine}</b>. We have {sideName} {Math.abs(edge).toFixed(1)} {pointWord} better than the books do.</>}
          {tEdge != null && total != null && !close(tEdge) && <> On the total, we lean <b>{tEdge > 0 ? 'over' : 'under'} {pts(total)}</b> by {Math.abs(tEdge).toFixed(1)}.</>}
        </p>
      )}
      {bet && bet.reasons?.length > 0 && <div className="reasons">{bet.reasons.map((r) => <span key={r.key} className="chip static">{r.text}</span>)}</div>}
      {final && res && (
        <p className="lc-say">
          {A} {game.away_score}, {H} {game.home_score}. {edge != null && !close(edge) ? <>{sideName} {sideLine} <b className={res === 'win' ? 'W' : res === 'loss' ? 'L' : ''}>{res === 'win' ? 'covered' : res === 'loss' ? "didn't cover" : 'pushed'}</b>.</> : null}
          {tres && tEdge != null && !close(tEdge) && <> The {tEdge > 0 ? 'over' : 'under'} <b className={tres === 'win' ? 'W' : tres === 'loss' ? 'L' : ''}>{tres === 'win' ? 'hit' : tres === 'loss' ? 'missed' : 'pushed'}</b>.</>}
          {bet?.clv != null && Math.abs(bet.clv) >= 0.5 && <> The line moved {Math.abs(bet.clv).toFixed(1)} {bet.clv > 0 ? 'toward us' : 'against us'} after we flagged it.</>}
        </p>
      )}
      {shop.length > 1 && (
        <p className="muted sm" style={{ margin: '8px 0 0' }}>Best number now: {shop.slice(0, 3).map((s) => `${bookLabel(s.book)} ${edge! > 0 ? sideNum(s.v) : sideNum(-s.v)}`).join(' · ')}</p>
      )}
      <p className="muted sm" style={{ margin: '10px 0 0' }}>The line is the middle of the sportsbooks ESPN lists{game.line_books && game.line_books > 1 ? ` (${game.line_books} books)` : ''}. For information and entertainment.</p>
    </div>
  );
}
