// The sport registry. Adding a sport = adding an entry here plus (if needed) a scoring-unit function.
// Everything else (schema, ingestion, ratings loop) is shared.

export type ScoringUnit = 'possession' | 'drive' | 'inning' | 'minute';

export interface SportConfig {
  id: string;
  name: string;
  espnPath: string;          // after /sports/
  espnGroups?: string;       // ESPN "groups" param meaning "all D-I" for this sport
  scoringUnit: ScoringUnit;
  seasonLabel: 'split' | 'calendar';
  regulationLength: number;  // minutes (hoops/soccer) or innings (diamond) in a regulation game
  // Given a team's box-score stats and the opponent's, estimate this team's scoring units in the game.
  // Return null when the box score lacks what's needed (ratings then skip the game).
  units(own: Stats, opp: Stats, game: GameCtx): number | null;
  // Points (or runs/goals) scored by this team.
  points(own: Stats, game: GameCtx): number;
  // Approximate season window used when sweeping scoreboard dates (month/day, inclusive).
  window: { start: [number, number]; end: [number, number] };
}

export type Stats = Record<string, number>;
export interface GameCtx { score: number; periods?: number | null }

const n = (s: Stats, k: string) => (Number.isFinite(s[k]) ? s[k] : NaN);

// KenPom-style possession estimate, averaged across both teams by the caller.
function hoopsPossessions(own: Stats, opp: Stats): number | null {
  const est = (s: Stats) => {
    const fga = n(s, 'fieldGoalsAttempted'), oreb = n(s, 'offensiveRebounds');
    const to = Number.isFinite(s['totalTurnovers']) ? s['totalTurnovers'] : n(s, 'turnovers');
    const fta = n(s, 'freeThrowsAttempted');
    if ([fga, oreb, to, fta].some((v) => !Number.isFinite(v))) return null;
    return fga - oreb + to + 0.475 * fta;
  };
  const a = est(own), b = est(opp);
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

export const SPORTS: Record<string, SportConfig> = {
  mbb: {
    id: 'mbb', name: "Men's Basketball",
    espnPath: 'basketball/mens-college-basketball', espnGroups: '50',
    scoringUnit: 'possession', seasonLabel: 'split', regulationLength: 40,
    units: hoopsPossessions, points: (s, g) => g.score,
    window: { start: [11, 1], end: [4, 10] },
  },
  wbb: {
    id: 'wbb', name: "Women's Basketball",
    espnPath: 'basketball/womens-college-basketball', espnGroups: '50',
    scoringUnit: 'possession', seasonLabel: 'split', regulationLength: 40,
    units: hoopsPossessions, points: (s, g) => g.score,
    window: { start: [11, 1], end: [4, 10] },
  },
  cfb: {
    id: 'cfb', name: 'Football',
    espnPath: 'football/college-football', espnGroups: '80',
    scoringUnit: 'drive', seasonLabel: 'calendar', regulationLength: 60,
    // ESPN football box scores don't report drives directly; the drives array in the summary does.
    // Ingest stores drive counts into stats.drives when available.
    units: (own) => (Number.isFinite(own['drives']) ? own['drives'] : null),
    points: (s, g) => g.score,
    window: { start: [8, 20], end: [1, 25] },
  },
  bsb: {
    id: 'bsb', name: 'Baseball',
    espnPath: 'baseball/college-baseball', espnGroups: '26',
    scoringUnit: 'inning', seasonLabel: 'calendar', regulationLength: 9,
    units: (own) => (Number.isFinite(own['inningsBatted']) ? own['inningsBatted'] : null),
    points: (s, g) => g.score,
    window: { start: [2, 10], end: [6, 30] },
  },
  sb: {
    id: 'sb', name: 'Softball',
    espnPath: 'baseball/college-softball', espnGroups: '26',
    scoringUnit: 'inning', seasonLabel: 'calendar', regulationLength: 7,
    units: (own) => (Number.isFinite(own['inningsBatted']) ? own['inningsBatted'] : null),
    points: (s, g) => g.score,
    window: { start: [2, 5], end: [6, 15] },
  },
  msoc: {
    id: 'msoc', name: "Men's Soccer",
    espnPath: 'soccer/usa.ncaa.m.1',
    scoringUnit: 'minute', seasonLabel: 'calendar', regulationLength: 90,
    units: () => 90, points: (s, g) => g.score,
    window: { start: [8, 15], end: [12, 20] },
  },
  wsoc: {
    id: 'wsoc', name: "Women's Soccer",
    espnPath: 'soccer/usa.ncaa.w.1',
    scoringUnit: 'minute', seasonLabel: 'calendar', regulationLength: 90,
    units: () => 90, points: (s, g) => g.score,
    window: { start: [8, 10], end: [12, 15] },
  },
};

export function sport(id: string): SportConfig {
  const s = SPORTS[id];
  if (!s) throw new Error(`Unknown sport '${id}'. Known: ${Object.keys(SPORTS).join(', ')}`);
  return s;
}

// ESPN's season year for a calendar date. Split seasons (hoops) label 2026-27 as 2027.
export function seasonYearFor(s: SportConfig, d: Date): number {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (s.seasonLabel === 'calendar') return s.window.end[0] < s.window.start[0] && m <= s.window.end[0] ? y - 1 : y;
  return m >= 7 ? y + 1 : y;
}

// All calendar dates (UTC) in a season's sweep window.
export function seasonDates(s: SportConfig, seasonYear: number, until: Date = new Date()): Date[] {
  const startYear = s.seasonLabel === 'split' ? seasonYear - 1 : (s.window.end[0] < s.window.start[0] ? seasonYear : seasonYear);
  const start = new Date(Date.UTC(startYear, s.window.start[0] - 1, s.window.start[1]));
  const endYear = s.window.end[0] < s.window.start[0] ? startYear + 1 : startYear;
  let end = new Date(Date.UTC(endYear, s.window.end[0] - 1, s.window.end[1]));
  if (end > until) end = until;
  const out: Date[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(new Date(d));
  return out;
}

export const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
