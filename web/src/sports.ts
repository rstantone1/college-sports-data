// What changes from sport to sport on screen and in the math.
export interface SportMeta {
  id: 'mbb' | 'wbb' | 'bsb' | 'sb' | 'cfb';
  tourney?: { field: number; autoBids: number; atLargeRank: number }; // tournament selection model
  short: string; long: string;
  seasons: { year: number; label: string }[];
  scale: number;          // ratings are points (runs) per `scale` units
  typicalUnits: number;   // units in a typical game at an average pace, for per-game display
  unitWord: string;       // 'possessions' | 'innings'
  pointWord: string;      // 'points' | 'runs'
  effLabel: string;       // how to read the margin
  hcaPerSide: number;     // home edge per side, in rating units
  sd: number;
  venue: 'court' | 'field';  // what a neutral site is called in this sport             // spread of real results around the expected margin (points/runs)
  hoops: boolean;
}

export const SPORTS: Record<string, SportMeta> = {
  mbb: { id: 'mbb', short: "Men's hoops", long: "Men's basketball", seasons: [{ year: 2027, label: '2026-27' }, { year: 2026, label: '2025-26' }],
    scale: 100, typicalUnits: 68, unitWord: 'possessions', pointWord: 'points', effLabel: 'points per 100 possessions', hcaPerSide: 2.2, sd: 11.3, venue: 'court', hoops: true, tourney: { field: 68, autoBids: 31, atLargeRank: 45 } },
  wbb: { id: 'wbb', short: "Women's hoops", long: "Women's basketball", seasons: [{ year: 2027, label: '2026-27' }, { year: 2026, label: '2025-26' }],
    scale: 100, typicalUnits: 70, unitWord: 'possessions', pointWord: 'points', effLabel: 'points per 100 possessions', hcaPerSide: 2.2, sd: 12.5, venue: 'court', hoops: true, tourney: { field: 68, autoBids: 31, atLargeRank: 45 } },
  cfb: { id: 'cfb', short: 'Football', long: 'Football (FBS)', seasons: [{ year: 2026, label: '2026' }],
    scale: 10, typicalUnits: 11.5, unitWord: 'drives', pointWord: 'points', effLabel: 'points per 10 drives', hcaPerSide: 0.65, sd: 16.8, venue: 'field', hoops: false },
  bsb: { id: 'bsb', short: 'Baseball', long: 'Baseball', seasons: [{ year: 2026, label: '2026' }],
    scale: 9, typicalUnits: 9, unitWord: 'innings', pointWord: 'runs', effLabel: 'runs per 9 innings', hcaPerSide: 0.15, sd: 5.9, venue: 'field', hoops: false },
  sb: { id: 'sb', short: 'Softball', long: 'Softball', seasons: [{ year: 2026, label: '2026' }],
    scale: 7, typicalUnits: 7, unitWord: 'innings', pointWord: 'runs', effLabel: 'runs per 7 innings', hcaPerSide: 0.15, sd: 4.7, venue: 'field', hoops: false },
};

export const sportMeta = (id?: string) => SPORTS[id ?? ''] ?? SPORTS.mbb;
