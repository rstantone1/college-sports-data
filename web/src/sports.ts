// What changes from sport to sport on screen and in the math.
export interface SportMeta {
  id: 'mbb' | 'wbb' | 'bsb' | 'sb';
  short: string; long: string;
  seasons: { year: number; label: string }[];
  scale: number;          // ratings are points (runs) per `scale` units
  unitWord: string;       // 'possessions' | 'innings'
  pointWord: string;      // 'points' | 'runs'
  effLabel: string;       // how to read the margin
  hcaPerSide: number;     // home edge per side, in rating units
  sd: number;             // spread of real results around the expected margin (points/runs)
  hoops: boolean;
}

export const SPORTS: Record<string, SportMeta> = {
  mbb: { id: 'mbb', short: "Men's hoops", long: "Men's basketball", seasons: [{ year: 2027, label: '2026-27' }, { year: 2026, label: '2025-26' }],
    scale: 100, unitWord: 'possessions', pointWord: 'points', effLabel: 'points per 100 possessions', hcaPerSide: 2.2, sd: 11, hoops: true },
  wbb: { id: 'wbb', short: "Women's hoops", long: "Women's basketball", seasons: [{ year: 2027, label: '2026-27' }, { year: 2026, label: '2025-26' }],
    scale: 100, unitWord: 'possessions', pointWord: 'points', effLabel: 'points per 100 possessions', hcaPerSide: 2.2, sd: 11.5, hoops: true },
  bsb: { id: 'bsb', short: 'Baseball', long: 'Baseball', seasons: [{ year: 2026, label: '2026' }],
    scale: 9, unitWord: 'innings', pointWord: 'runs', effLabel: 'runs per 9 innings', hcaPerSide: 0.15, sd: 4.3, hoops: false },
  sb: { id: 'sb', short: 'Softball', long: 'Softball', seasons: [{ year: 2026, label: '2026' }],
    scale: 7, unitWord: 'innings', pointWord: 'runs', effLabel: 'runs per 7 innings', hcaPerSide: 0.15, sd: 3.8, hoops: false },
};

export const sportMeta = (id?: string) => SPORTS[id ?? ''] ?? SPORTS.mbb;
