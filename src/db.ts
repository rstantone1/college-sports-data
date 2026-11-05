import 'dotenv/config';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

// Supabase (and most hosted Postgres) needs TLS; node-postgres treats sslmode=require as full
// certificate verification and fails on the pooler's chain. Strip it and pass ssl explicitly.
const rawUrl = process.env.DATABASE_URL ?? '';
const isLocal = /localhost|127\.0\.0\.1|host=\/tmp/.test(rawUrl);
const url = rawUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
if (!rawUrl) console.error('DATABASE_URL is not set');
else console.log(`db: ${url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@')}`);

export const pool = new Pool({
  connectionString: url,
  max: 8,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export async function migrate(dir = join(process.cwd(), 'db', 'migrations')) {
  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  // Several jobs start at once (one per sport). A session lock makes them take turns, and the list of applied
  // migrations is read after the lock is held, so a migration another job just applied is skipped, not re-run.
  const c = await pool.connect();
  try {
    await c.query(`select pg_advisory_lock(727001)`);
    const done = new Set((await c.query<{ name: string }>(`select name from schema_migrations`)).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      try {
        await c.query('begin');
        await c.query(sql);
        await c.query(`insert into schema_migrations(name) values ($1) on conflict do nothing`, [f]);
        await c.query('commit');
        console.log(`applied ${f}`);
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
  } finally {
    await c.query(`select pg_advisory_unlock(727001)`).catch(() => {});
    c.release();
  }
}

export async function close() {
  await pool.end();
}
