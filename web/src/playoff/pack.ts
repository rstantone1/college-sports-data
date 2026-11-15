// Turns what the site already knows (ratings, the schedule, results) plus the committee's latest ranking and
// ESPN's live scoreboard into the compact pack the simulator runs on.
import type { Rating, Game } from '../api';
import { predict, league } from '../model';
import { sportMeta } from '../sports';
import { COMMITTEE, formatFor, resume } from './config';
import { normCdf, type Pack, type PTeam, type PGame, type PConf } from './sim';

export interface LiveGame { espnId: string; state: 'final' | 'live' | 'pre'; hs: number; as: number; frac: number; detail: string }
export interface CfpRank { teamId?: number; espnId?: string; rank: number }
export interface CfpRelease { date: number; ranks: CfpRank[] }

const TITLE = /championship/i, NOT_TITLE = /FCS|playoff|bowl|first round|second round|quarterfinal|semifinal/i;
const confFromNote = (note: string, confs: PConf[]) => { const n = note.replace(/Conference USA/i, 'CUSA'); return confs.findIndex((c) => new RegExp(`\\b${c.name.replace(/[-.]/g, '.?')}\\b`, 'i').test(n)); };
const dead = (g: Game) => /cancel|postpone|forfeit/i.test(g.status ?? '');
// Football weeks run Tuesday to Monday.
const weekOf = (t: number) => Math.floor((t - Date.UTC(2026, 7, 25)) / (7 * 864e5));

export function buildPack(season: number, ratings: Rating[], games: Game[], cfp: CfpRelease | null, live: LiveGame[], now = Date.now()): Pack {
  const m = sportMeta('cfb'), L = league(ratings), F = formatFor(season), sel = +new Date(F.selection);
  const idx = new Map(ratings.map((r, i) => [r.team_id, i]));
  const avg = { adj_off: L.off, adj_def: L.off, tempo: L.tempo } as Rating;
  const e12 = [...ratings].map((r) => r.adj_em).sort((a, b) => b - a)[11] ?? 0;
  const bubble = { adj_off: L.off + e12 / 2, adj_def: L.off - e12 / 2, tempo: L.tempo } as Rating;
  const FCS = normCdf(29 / m.sd);   // a bubble team against a team from outside FBS
  const hca = predict(avg, avg, L, 1, 'cfb').margin;

  const confNames = [...new Set(ratings.map((r) => r.conference_short ?? r.conference_name).filter((c): c is string => !!c && !/indep/i.test(c)))].sort();
  const confs: PConf[] = confNames.map((name) => ({ name, teams: [], power: F.power.includes(name), title: true }));
  const byTeam = new Map<number, number>(), byEspn = new Map<string, number>();
  for (const k of cfp?.ranks ?? []) { if (k.teamId != null) byTeam.set(k.teamId, k.rank); else if (k.espnId) byEspn.set(k.espnId, k.rank); }
  const teams: PTeam[] = ratings.map((r, i) => {
    const cn = r.conference_short ?? r.conference_name ?? ''; const c = confNames.indexOf(cn); if (c >= 0) confs[c].teams.push(i);
    const nd = r.abbreviation === 'ND';
    return { id: r.team_id, name: r.short_name, abbr: r.abbreviation, logo: r.logo_url, color: r.color, conf: c, power: (c >= 0 && confs[c].power) || nd, nd,
      w: 0, l: 0, cw: 0, cl: 0, wab: 0, pr: predict(r, avg, L, 0, 'cfb').margin, bub: predict(bubble, r, L, 0, 'cfb').aWin,
      cfp: byTeam.get(r.team_id) ?? byEspn.get(String(r.team_espn_id ?? '')) ?? null, anchor: 0, ourRank: r.rank };
  });
  const liveBy = new Map(live.map((x) => [x.espnId, x]));
  // Resume as of the committee's last ranking, to measure how far they are from our score for each team.
  const atRank = teams.map(() => ({ wab: 0, l: 0 }));
  const h2h: Record<string, number> = {}; const out: PGame[] = [];
  for (const g of [...games].sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time))) {
    const t = +new Date(g.start_time); if (dead(g) || g.season_type === 3 || t > sel) continue;
    const note = g.notes ?? ''; const isTitle = TITLE.test(note) && !NOT_TITLE.test(note);
    if (TITLE.test(note) && !isTitle) continue;                       // FCS playoff games and the like
    const h = idx.get(g.home_team_id) ?? -1, a = idx.get(g.away_team_id) ?? -1;
    if (h < 0 && a < 0) continue;
    if (isTitle) { const c = confFromNote(note, confs); if (c >= 0 && h >= 0 && a >= 0 && !g.completed) { confs[c].set = [h, a]; } if (!g.completed) continue; }
    const lv = liveBy.get(String(g.espn_id));
    const H = h >= 0 ? ratings[h] : null, A = a >= 0 ? ratings[a] : null;
    const site: 1 | 0 = g.neutral_site ? 0 : 1;
    const pre = H && A ? predict(H, A, L, site, 'cfb') : null;
    const bubH = A ? predict(bubble, A, L, site, 'cfb').aWin : FCS, bubA = H ? 1 - predict(H, bubble, L, site, 'cfb').aWin : FCS;
    const conf = !isTitle && h >= 0 && a >= 0 && teams[h].conf >= 0 && teams[h].conf === teams[a].conf;
    const final = (g.completed && g.home_score != null && g.away_score != null) || lv?.state === 'final';
    if (final) {
      const hs = g.completed && g.home_score != null ? g.home_score : lv!.hs, as = g.completed && g.away_score != null ? g.away_score! : lv!.as;
      const hw = hs > as;
      if (h >= 0) { const T = teams[h]; if (hw) T.w++; else T.l++; T.wab += (hw ? 1 : 0) - bubH; if (conf) { if (hw) T.cw++; else T.cl++; } if (cfp && t < cfp.date) { atRank[h].wab += (hw ? 1 : 0) - bubH; if (!hw) atRank[h].l++; } }
      if (a >= 0) { const T = teams[a]; if (hw) T.l++; else T.w++; T.wab += (hw ? 0 : 1) - bubA; if (conf) { if (hw) T.cl++; else T.cw++; } if (cfp && t < cfp.date) { atRank[a].wab += (hw ? 0 : 1) - bubA; if (hw) atRank[a].l++; } }
      if (conf) h2h[h < a ? `${h}-${a}` : `${a}-${h}`] = hw ? h : a;
      continue;
    }
    if (t < now - 30 * 3600e3 && !lv) continue;                        // long past with no result: not happening
    let p = pre ? pre.aWin : h >= 0 ? normCdf((teams[h].pr + 29) / m.sd) : 1 - normCdf((teams[a].pr + 29) / m.sd);
    let liveInfo: PGame['live'];
    if (lv?.state === 'live') {                                         // in progress: the score and the clock take over from the pregame number
      const f = Math.min(1, Math.max(0.01, lv.frac)), mar = pre ? pre.margin : (p - 0.5) * 40;
      p = Math.min(0.995, Math.max(0.005, normCdf((lv.hs - lv.as + mar * f) / (m.sd * Math.sqrt(f)))));
      liveInfo = { hs: lv.hs, as: lv.as, detail: lv.detail };
    }
    out.push({ key: String(g.id), id: g.id, date: t, week: weekOf(t), h, a, neutral: !!g.neutral_site, conf, p, bubH, bubA, live: liveInfo });
  }
  // Committee anchor: the r-th ranked team "should" have had the r-th best score that day.
  if (cfp) {
    const sc = teams.map((t, i) => resume(COMMITTEE.beta, { wab: atRank[i].wab, pr: t.pr, l: atRank[i].l, power: t.power }));
    const sorted = [...sc].sort((x, y) => y - x); const floor = sorted[Math.min(sorted.length - 1, 29)];
    teams.forEach((t, i) => { t.anchor = t.cfp != null ? sorted[t.cfp - 1] - sc[i] : sc[i] > floor ? floor - sc[i] : 0; });
  }
  const releasesLeft = cfp ? Math.max(0, Math.round((sel - cfp.date) / (7 * 864e5))) : 99;
  return { season, teams, games: out, confs, h2h, hca, sd: m.sd, releasesLeft, format: F, committee: cfp ? COMMITTEE : { ...COMMITTEE, carry: () => 0, noise: () => 1.7 } };
}
