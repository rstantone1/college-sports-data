-- Pregame lines from ESPN's pickcenter. odds holds every listed provider; spread is the market line from the
-- home team's view (negative = home favored); total is the over/under; odds_provider names the book used.
alter table games add column if not exists odds jsonb,
                  add column if not exists spread numeric,
                  add column if not exists total numeric,
                  add column if not exists odds_provider text;
