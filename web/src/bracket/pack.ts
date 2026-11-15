// Builds the basketball tournament pack from the site's ratings and schedule.
import type { Rating, Game } from '../api';
import { predict, league } from '../model';
import { sportMeta } from '../sports';
import { normCdf, type BPack, type BTeam, type BGame, type BConf, type BFormat } from './sim';

// 2027: both tournaments have 76 teams. Thirty-one conference champions, 45 at-large teams, and a 12-game opening
// round (assumed here to be the last 12 at-large teams and the 12 lowest-ranked champions) feeding a 64-team bracket.
export const FORMATS: Record<string, BFormat & { selection: string; bubbleRank: number; outsider: number }> = {
  mbb: { size: 76, autos: 31, opening: 24, powerWeight: 0, noise: 0.6, rounds: ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite Eight', 'Final Four', 'Title game', 'National champion'], selection: '2027-03-14T22:00:00Z', bubbleRank: 45, outsider: 40 },
  wbb: { size: 76, autos: 31, opening: 24, powerWeight: 0.4, noise: 0.6, rounds: ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite Eight', 'Final Four', 'Title game', 'National champion'], selection: '2027-03-14T22:00:00Z', bubbleRank: 45, outsider: 45 },
};
const dead = (g: Game) => /cancel|postpone|forfeit/i.test(g.status ?? '');

export function buildBracketPack(sport: string, season: number, ratings: Rating[], games: Game[], now = Date.now()): BPack {
  const m = sportMeta(sport), L = league(ratings), F = FORMATS[sport], sel = +new Date(F.selection);
  const idx = new Map(ratings.map((r, i) => [r.team_id, i]));
  const avg = { adj_off: L.off, adj_def: L.off, tempo: L.tempo } as Rating;
  const eb = [...ratings].map((r) => r.adj_em).sort((a, b) => b - a)[F.bubbleRank - 1] ?? 0;
  const bubble = { adj_off: L.off + eb / 2, adj_def: L.off - eb / 2, tempo: L.tempo } as Rating;
  const OUT = normCdf(F.outsider / m.sd);
  const names = [...new Set(ratings.map((r) => r.conference_short ?? r.conference_name).filter((c): c is string => !!c && !/indep/i.test(c)))].sort();
  const confs: BConf[] = names.map((name) => ({ name, teams: [] }));
  const teams: BTeam[] = ratings.map((r, i) => { const c = names.indexOf(r.conference_short ?? r.conference_name ?? ''); if (c >= 0) confs[c].teams.push(i);
    return { id: r.team_id, name: r.short_name, abbr: r.abbreviation, logo: r.logo_url, conf: c, w: 0, l: 0, cw: 0, cl: 0, wab: 0, pr: predict(r, avg, L, 0, sport).margin, bub: predict(bubble, r, L, 0, sport).aWin, ourRank: r.rank }; });
  const out: BGame[] = [];
  for (const g of games) {
    const t = +new Date(g.start_time); if (dead(g) || g.season_type === 3 || t > sel) continue;
    const h = idx.get(g.home_team_id) ?? -1, a = idx.get(g.away_team_id) ?? -1; if (h < 0 && a < 0) continue;
    const H = h >= 0 ? ratings[h] : null, A = a >= 0 ? ratings[a] : null, site: 1 | 0 = g.neutral_site ? 0 : 1;
    const bubH = A ? predict(bubble, A, L, site, sport).aWin : OUT, bubA = H ? 1 - predict(H, bubble, L, site, sport).aWin : OUT;
    const conf = h >= 0 && a >= 0 && teams[h].conf >= 0 && teams[h].conf === teams[a].conf;
    if (g.completed && g.home_score != null && g.away_score != null) { const hw = g.home_score > g.away_score;
      if (h >= 0) { const T = teams[h]; if (hw) T.w++; else T.l++; T.wab += (hw ? 1 : 0) - bubH; if (conf) { if (hw) T.cw++; else T.cl++; } }
      if (a >= 0) { const T = teams[a]; if (hw) T.l++; else T.w++; T.wab += (hw ? 0 : 1) - bubA; if (conf) { if (hw) T.cl++; else T.cw++; } }
      continue; }
    if (t < now - 8 * 3600e3) continue;
    const pre = H && A ? predict(H, A, L, site, sport) : null;
    const p = pre ? pre.aWin : h >= 0 ? normCdf((teams[h].pr + F.outsider) / m.sd) : 1 - normCdf((teams[a].pr + F.outsider) / m.sd);
    out.push({ key: String(g.id), date: t, h, a, neutral: !!g.neutral_site, conf, p, m: pre ? pre.margin : 0, bubH, bubA, soon: t < now + 3 * 864e5 });
  }
  out.sort((x, y) => x.date - y.date);
  // How unsure we are of each team's true strength, in points: about five early, under two by March.
  const played = teams.reduce((a, t) => a + t.w + t.l, 0) / Math.max(1, teams.length);
  const ratingSd = 1.5 + 3.5 * Math.max(0, 1 - played / 28);
  return { sport, season, teams, games: out, confs, sd: m.sd, ratingSd, format: F };
}
