import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mini-.env-lader (server/.env), zonder dependency en werkend op elke Node-versie.
// Bestaande omgevingsvariabelen (zoals op Render) winnen altijd.
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* geen .env — prima, dan alleen echte env-vars */ }

// COUNT/SUM komen uit Postgres als string (bigint/numeric) — geef ze als number terug.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL ontbreekt — zet hem in server/.env (lokaal) of in Render (productie).');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: 5,
});

// De SQL in dit project gebruikt '?'-placeholders (SQLite-stijl); vertaal naar $1, $2, …
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export async function all(sql, params = []) { return (await pool.query(toPg(sql), params)).rows; }
export async function get(sql, params = []) { return (await all(sql, params))[0]; }
export async function run(sql, params = []) { return pool.query(toPg(sql), params); }

// Transactie: fn krijgt dezelfde helpers, gebonden aan één client.
export async function tx(fn) {
  const client = await pool.connect();
  const h = {
    all: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
    get: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0],
    run: (sql, params = []) => client.query(toPg(sql), params),
  };
  try {
    await client.query('BEGIN');
    const result = await fn(h);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT,
  salt TEXT,
  google_id TEXT UNIQUE,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cycling_teams (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL UNIQUE,
  abbreviation TEXT,
  shirt_url TEXT
);

CREATE TABLE IF NOT EXISTS riders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES cycling_teams(id),
  nationality TEXT,
  age INTEGER,
  price INTEGER NOT NULL,
  type TEXT,
  qualities TEXT NOT NULL DEFAULT '{}',
  last_started_stage INTEGER,
  bib INTEGER
);

CREATE TABLE IF NOT EXISTS stages (
  nr INTEGER PRIMARY KEY,
  start TEXT NOT NULL,
  van TEXT NOT NULL,
  naar TEXT NOT NULL,
  km INTEGER,
  terrain TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  image_url TEXT,
  description TEXT,
  result_source TEXT
);

CREATE TABLE IF NOT EXISTS stage_sync (
  stage_nr INTEGER PRIMARY KEY REFERENCES stages(nr),
  checked_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS user_teams (
  user_id INTEGER NOT NULL REFERENCES users(id),
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  PRIMARY KEY (user_id, rider_id)
);

CREATE TABLE IF NOT EXISTS lineups (
  user_id INTEGER NOT NULL REFERENCES users(id),
  stage_nr INTEGER NOT NULL REFERENCES stages(nr),
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  is_captain INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stage_nr, rider_id)
);

CREATE TABLE IF NOT EXISTS stage_results (
  stage_nr INTEGER NOT NULL REFERENCES stages(nr),
  position INTEGER NOT NULL,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  PRIMARY KEY (stage_nr, position)
);

CREATE TABLE IF NOT EXISTS ttt_results (
  stage_nr INTEGER NOT NULL REFERENCES stages(nr),
  position INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES cycling_teams(id),
  PRIMARY KEY (stage_nr, position)
);

CREATE TABLE IF NOT EXISTS classification_standings (
  stage_nr INTEGER NOT NULL REFERENCES stages(nr),
  classification TEXT NOT NULL,
  position INTEGER NOT NULL,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  PRIMARY KEY (stage_nr, classification, position)
);

CREATE TABLE IF NOT EXISTS final_standings (
  classification TEXT NOT NULL,
  position INTEGER NOT NULL,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  PRIMARY KEY (classification, position)
);

CREATE TABLE IF NOT EXISTS rider_points (
  stage_nr INTEGER NOT NULL,
  rider_id INTEGER NOT NULL REFERENCES riders(id),
  category TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (stage_nr, rider_id, category)
);

CREATE TABLE IF NOT EXISTS user_scores (
  user_id INTEGER NOT NULL REFERENCES users(id),
  stage_nr INTEGER NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (user_id, stage_nr)
);

CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pool_members (
  pool_id INTEGER NOT NULL REFERENCES pools(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, user_id)
);

CREATE TABLE IF NOT EXISTS lineup_reminders (
  user_id INTEGER NOT NULL REFERENCES users(id),
  stage_nr INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stage_nr)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export async function initSchema() {
  await pool.query(SCHEMA_SQL);
  // Migratie voor bestaande databases van vóór de letour.fr-sync.
  await pool.query('ALTER TABLE riders ADD COLUMN IF NOT EXISTS bib INTEGER');
  // Migratie voor "Raak gekozen?": optimale etappescore (beste opstelling + kopman).
  await pool.query('ALTER TABLE user_scores ADD COLUMN IF NOT EXISTS optimal_points INTEGER');
}

export const BUDGET = 45_000_000;
export const TEAM_SIZE = 20;
export const MAX_PER_CYCLING_TEAM = 4;
export const LINEUP_SIZE = 9;
export const MIN_RIDER_PRICE = 500_000;
export const CAPTAIN_FACTOR = 2;

// Renner is gestart in etappe `nr` als hij (nog) niet is uitgevallen,
// of zijn laatste gestarte etappe >= nr is.
export function riderStarted(rider, stageNr) {
  return rider.last_started_stage == null || rider.last_started_stage >= stageNr;
}
