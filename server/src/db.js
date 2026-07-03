import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'snorito.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycling_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  abbreviation TEXT
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
  last_started_stage INTEGER
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
  description TEXT
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pool_members (
  pool_id INTEGER NOT NULL REFERENCES pools(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pool_id, user_id)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

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
