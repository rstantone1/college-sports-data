// Model settings per sport. Defaults until the multi-season tuner sets them; every change here is recorded with
// the backtest that justified it.
import { DEFAULT_PARAMS, type Params } from './engine.js';

const BY_SPORT: Record<string, Partial<Params>> = {};

export function paramsFor(sport: string): Params {
  return { ...DEFAULT_PARAMS, ...(BY_SPORT[sport] ?? {}) };
}
