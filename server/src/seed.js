import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, BUDGET, TEAM_SIZE, MAX_PER_CYCLING_TEAM, MIN_RIDER_PRICE, LINEUP_SIZE } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vult een lege database met renners, etappes, demo-gebruikers en een demo-poule.
export function runSeed({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const ridersJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'scorito_tdf2026_riders.json'), 'utf8'));
  const stagesJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'stages_tdf2026.json'), 'utf8'));

  log(`Seeding: ${ridersJson.length} renners, ${stagesJson.length} etappes`);

  const wipe = db.transaction(() => {
    for (const t of [
      'user_scores', 'rider_points', 'final_standings', 'classification_standings',
      'ttt_results', 'stage_results', 'lineups', 'user_teams', 'pool_members', 'pools',
      'sessions', 'users', 'riders', 'cycling_teams', 'stages',
    ]) db.prepare(`DELETE FROM ${t}`).run();
  });
  wipe();

  // --- ploegen en renners -----------------------------------------------------
  const teamNames = [...new Set(ridersJson.map((r) => r.team))];
  const insTeam = db.prepare('INSERT INTO cycling_teams (name) VALUES (?)');
  const teamIdByName = {};
  for (const name of teamNames) teamIdByName[name] = insTeam.run(name).lastInsertRowid;

  const insRider = db.prepare(`
    INSERT INTO riders (id, name, team_id, nationality, age, price, type, qualities)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of ridersJson) {
    insRider.run(r.riderId, r.naam, teamIdByName[r.team], r.nationaliteit, r.leeftijd, r.marktwaarde, r.type, JSON.stringify(r.kwaliteiten));
  }

  // --- etappes ----------------------------------------------------------------
  const insStage = db.prepare('INSERT INTO stages (nr, start, van, naar, km, terrain, type, status, image_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const s of stagesJson) {
    insStage.run(s.nr, s.start, s.van, s.naar, s.km, s.terrain, s.type, 'open', s.profielUrl || null, s.beschrijving || null);
  }

  // --- gebruikers -------------------------------------------------------------
  const createUser = (name, email, password, isAdmin = 0) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return db.prepare('INSERT INTO users (name, email, pass_hash, salt, is_admin) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, hash, salt, isAdmin).lastInsertRowid;
  };

  createUser('Beheerder', 'admin@snorito.app', 'admin123', 1);
  const demoUsers = [
    createUser('Max', 'max@demo.nl', 'demo123'),
    createUser('Anna', 'anna@demo.nl', 'demo123'),
    createUser('Piet', 'piet@demo.nl', 'demo123'),
    createUser('Kees', 'kees@demo.nl', 'demo123'),
  ];

  // --- demo-teams (geldig: 20 renners, budget, max 4 per ploeg) ---------------
  const allRiders = db.prepare('SELECT * FROM riders ORDER BY price DESC, id').all();

  const buildDemoTeam = (seed) => {
    const rnd = mulberry32(seed);
    const shuffled = [...allRiders].sort(() => rnd() - 0.5);
    shuffled.sort((a, b) => (rnd() < 0.35 ? b.price - a.price : 0));
    const picked = [];
    const perTeam = {};
    let spent = 0;
    for (const r of shuffled) {
      if (picked.length === TEAM_SIZE) break;
      const remaining = TEAM_SIZE - picked.length - 1;
      if ((perTeam[r.team_id] || 0) >= MAX_PER_CYCLING_TEAM) continue;
      if (spent + r.price + remaining * MIN_RIDER_PRICE > BUDGET) continue;
      picked.push(r);
      perTeam[r.team_id] = (perTeam[r.team_id] || 0) + 1;
      spent += r.price;
    }
    return picked;
  };

  const insUserTeam = db.prepare('INSERT INTO user_teams (user_id, rider_id) VALUES (?, ?)');
  const insLineup = db.prepare('INSERT INTO lineups (user_id, stage_nr, rider_id, is_captain) VALUES (?, ?, ?, ?)');

  demoUsers.forEach((userId, i) => {
    const team = buildDemoTeam(42 + i * 7);
    for (const r of team) insUserTeam.run(userId, r.id);
    const lineup = [...team].sort((a, b) => b.price - a.price).slice(0, LINEUP_SIZE);
    for (const stageNr of [1, 2]) {
      lineup.forEach((r, idx) => insLineup.run(userId, stageNr, r.id, idx === 0 ? 1 : 0));
    }
  });

  // --- demo-poule -------------------------------------------------------------
  const poolId = db.prepare('INSERT INTO pools (name, code, owner_id) VALUES (?, ?, ?)')
    .run('Demo Vriendenpoule', 'DEMO01', demoUsers[0]).lastInsertRowid;
  for (const uid of demoUsers) {
    db.prepare('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)').run(poolId, uid);
  }

  log('\nSeed voltooid — alle etappes open, team is aan te passen tot de start van etappe 1.');
  log('Inloggen kan met:');
  log('  admin@snorito.app / admin123  (beheerder)');
  log('  max@demo.nl / demo123  (+ anna, piet, kees @demo.nl)');
  log('  Demo-poule code: DEMO01');
  log('Fictieve uitslagen voor etappe 1+2 laden (om het puntensysteem te zien): npm run demo');
}

// Seedt alleen wanneer de database nog leeg is (voor eerste boot op een verse host).
export function ensureSeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM riders').get().c;
  if (count === 0) {
    console.log('Lege database gevonden — seed wordt uitgevoerd…');
    runSeed({ quiet: true });
  }
}

// Direct uitgevoerd (npm run seed): altijd opnieuw seeden.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed();
}
