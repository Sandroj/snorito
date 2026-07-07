import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  get, run, tx, initSchema, pool,
  BUDGET, TEAM_SIZE, MAX_PER_CYCLING_TEAM, MIN_RIDER_PRICE, LINEUP_SIZE,
} from './db.js';

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
export async function runSeed({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const ridersJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'scorito_tdf2026_riders.json'), 'utf8'));
  const stagesJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'stages_tdf2026.json'), 'utf8'));
  const teamsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'teams_tdf2026.json'), 'utf8'));
  const teamMeta = Object.fromEntries(teamsJson.map((t) => [t.name, t]));

  log(`Seeding: ${ridersJson.length} renners, ${stagesJson.length} etappes, ${teamsJson.length} ploegen`);

  await initSchema();

  await tx(async (h) => {
    for (const t of [
      'user_scores', 'rider_points', 'final_standings', 'classification_standings',
      'ttt_results', 'stage_results', 'lineups', 'user_teams', 'pool_members', 'pools',
      'login_events', 'password_resets', 'sessions', 'users', 'riders', 'stage_sync', 'stages', 'cycling_teams',
    ]) await h.run(`DELETE FROM ${t}`);

    // --- ploegen en renners ---------------------------------------------------
    const teamNames = [...new Set(ridersJson.map((r) => r.team))];
    const teamIdByName = {};
    for (const name of teamNames) {
      const meta = teamMeta[name];
      const row = await h.get(
        'INSERT INTO cycling_teams (name, abbreviation, shirt_url) VALUES (?, ?, ?) RETURNING id',
        [name, meta?.abbr ?? null, meta?.shirt ?? null]
      );
      teamIdByName[name] = row.id;
    }

    for (const r of ridersJson) {
      await h.run(`
        INSERT INTO riders (id, name, team_id, nationality, age, price, type, qualities, bib)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [r.riderId, r.naam, teamIdByName[r.team], r.nationaliteit, r.leeftijd, r.marktwaarde, r.type, JSON.stringify(r.kwaliteiten), r.bib ?? null]);
    }

    // --- etappes ---------------------------------------------------------------
    for (const s of stagesJson) {
      await h.run(
        'INSERT INTO stages (nr, start, van, naar, km, terrain, type, status, image_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [s.nr, s.start, s.van, s.naar, s.km, s.terrain, s.type, 'open', s.profielUrl || null, s.beschrijving || null]
      );
    }

    // --- gebruikers ------------------------------------------------------------
    const createUser = async (name, email, password, isAdmin = 0) => {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 32).toString('hex');
      const row = await h.get(
        'INSERT INTO users (name, email, pass_hash, salt, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING id',
        [name, email, hash, salt, isAdmin]
      );
      return row.id;
    };

    await createUser('Beheerder', 'admin@snorito.app', 'admin123', 1);
    const demoUsers = [
      await createUser('Max', 'max@demo.nl', 'demo123'),
      await createUser('Anna', 'anna@demo.nl', 'demo123'),
      await createUser('Piet', 'piet@demo.nl', 'demo123'),
      await createUser('Kees', 'kees@demo.nl', 'demo123'),
    ];

    // --- demo-teams (geldig: 20 renners, budget, max 4 per ploeg) ---------------
    const allRiders = await h.all('SELECT * FROM riders ORDER BY price DESC, id');

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

    for (const [i, userId] of demoUsers.entries()) {
      const team = buildDemoTeam(42 + i * 7);
      for (const r of team) await h.run('INSERT INTO user_teams (user_id, rider_id) VALUES (?, ?)', [userId, r.id]);
      const lineup = [...team].sort((a, b) => b.price - a.price).slice(0, LINEUP_SIZE);
      for (const stageNr of [1, 2]) {
        for (const [idx, r] of lineup.entries()) {
          await h.run('INSERT INTO lineups (user_id, stage_nr, rider_id, is_captain) VALUES (?, ?, ?, ?)', [userId, stageNr, r.id, idx === 0 ? 1 : 0]);
        }
      }
    }

    // --- demo-poule ------------------------------------------------------------
    const demoPool = await h.get('INSERT INTO pools (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', ['Demo Vriendenpoule', 'DEMO01', demoUsers[0]]);
    for (const uid of demoUsers) {
      await h.run('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)', [demoPool.id, uid]);
    }
  });

  log('\nSeed voltooid — alle etappes open, team is aan te passen tot de start van etappe 1.');
  log('Inloggen kan met:');
  log('  admin@snorito.app / admin123  (beheerder)');
  log('  max@demo.nl / demo123  (+ anna, piet, kees @demo.nl)');
  log('  Demo-poule code: DEMO01');
  log('Fictieve uitslagen voor etappe 1+2 laden (om het puntensysteem te zien): npm run demo');
}

// Seedt alleen wanneer de database nog leeg is (voor eerste boot op een verse host).
export async function ensureSeeded() {
  await initSchema();
  const count = (await get('SELECT COUNT(*) AS c FROM riders')).c;
  if (count === 0) {
    console.log('Lege database gevonden — seed wordt uitgevoerd…');
    await runSeed({ quiet: true });
  }
  await syncAdminPassword();
}

// Opt-in beveiliging: het seed-adminaccount (admin@snorito.app) staat met zijn
// standaardwachtwoord in deze publieke repo. Zet in Render de env-var
// ADMIN_PASSWORD en bij de eerstvolgende (her)start neemt het account dat
// wachtwoord over. Zonder env-var verandert er niets — bewuste keuze van Max
// (7 juli 2026), het mechanisme staat klaar voor als hij het gat wil dichten.
async function syncAdminPassword() {
  const wanted = process.env.ADMIN_PASSWORD;
  if (!wanted) return;
  const admin = await get('SELECT * FROM users WHERE email = ?', ['admin@snorito.app']);
  if (!admin) return;
  const hash = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
  if (hash(wanted, admin.salt) === admin.pass_hash) return; // al in sync
  const salt = crypto.randomBytes(16).toString('hex');
  await run('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?', [hash(wanted, salt), salt, admin.id]);
  await run('DELETE FROM sessions WHERE user_id = ?', [admin.id]); // oude (mogelijk vreemde) sessies eruit
  console.log('Adminwachtwoord overgenomen uit ADMIN_PASSWORD; bestaande adminsessies zijn uitgelogd.');
}

// Direct uitgevoerd (npm run seed): altijd opnieuw seeden.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSeed();
  await pool.end();
}
