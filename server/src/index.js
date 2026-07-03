import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  db, BUDGET, TEAM_SIZE, MAX_PER_CYCLING_TEAM, LINEUP_SIZE, MIN_RIDER_PRICE, CAPTAIN_FACTOR,
} from './db.js';
import {
  processStage, processFinal, CLASSIFICATIONS, FINAL_POINTS,
  STAGE_POINTS, TTT_POINTS, CLASS_POINTS_AFTER_STAGE, TEAM_POINTS_AFTER_STAGE, FINAL_TEAM_POINTS,
} from './points.js';
import { ensureSeeded } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Op een verse host is de database leeg — vul hem dan met renners, etappes en demo-data.
ensureSeeded();

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- auth helpers -----------------------------------------------------------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map((s) => {
      const i = s.indexOf('=');
      return [s.slice(0, i).trim(), decodeURIComponent(s.slice(i + 1))];
    })
  );
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token) || null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { res.status(401).json({ error: 'Niet ingelogd' }); return null; }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (user && !user.is_admin) { res.status(403).json({ error: 'Geen beheerder' }); return null; }
  return user;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, isAdmin: !!u.is_admin });

// --- auth routes ------------------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Naam, e-mail en wachtwoord zijn verplicht' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'E-mailadres is al in gebruik' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO users (name, email, pass_hash, salt) VALUES (?, ?, ?, ?)')
    .run(name, email, hashPassword(password, salt), salt);
  startSession(res, info.lastInsertRowid);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user || hashPassword(password || '', user.salt) !== user.pass_hash) {
    return res.status(401).json({ error: 'Onjuiste inloggegevens' });
  }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ user: null });
  const teamCount = db.prepare('SELECT COUNT(*) AS c FROM user_teams WHERE user_id = ?').get(user.id).c;
  res.json({ user: publicUser(user), teamCount, teamComplete: teamCount === TEAM_SIZE });
});

// --- basisdata --------------------------------------------------------------

app.get('/api/riders', (_req, res) => {
  const riders = db.prepare(`
    SELECT r.*, t.name AS team_name, t.abbreviation AS team_abbr
    FROM riders r JOIN cycling_teams t ON t.id = r.team_id
    ORDER BY r.price DESC, r.name
  `).all().map((r) => ({ ...r, qualities: JSON.parse(r.qualities) }));
  res.json({ riders, budget: BUDGET, teamSize: TEAM_SIZE, maxPerTeam: MAX_PER_CYCLING_TEAM });
});

app.get('/api/stages', (_req, res) => {
  res.json({ stages: db.prepare('SELECT * FROM stages ORDER BY nr').all() });
});

// Spelregels en puntentabellen — rechtstreeks uit de puntenmotor (server/src/points.js),
// zodat wat de speler leest altijd overeenkomt met wat er wordt berekend.
app.get('/api/rules', (_req, res) => {
  res.json({
    budget: BUDGET,
    teamSize: TEAM_SIZE,
    maxPerTeam: MAX_PER_CYCLING_TEAM,
    lineupSize: LINEUP_SIZE,
    minRiderPrice: MIN_RIDER_PRICE,
    captainFactor: CAPTAIN_FACTOR,
    stagePoints: STAGE_POINTS,
    tttPoints: TTT_POINTS,
    classPointsAfterStage: CLASS_POINTS_AFTER_STAGE,
    teamPointsAfterStage: TEAM_POINTS_AFTER_STAGE,
    finalPoints: FINAL_POINTS,
    finalTeamPoints: FINAL_TEAM_POINTS,
  });
});

// --- teamselectie -----------------------------------------------------------

const teamLocked = () =>
  db.prepare('SELECT status FROM stages WHERE nr = 1').get()?.status !== 'open';

app.get('/api/team', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const riderIds = db.prepare('SELECT rider_id FROM user_teams WHERE user_id = ?').all(user.id).map((r) => r.rider_id);
  res.json({ riderIds, locked: teamLocked() });
});

app.put('/api/team', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (teamLocked()) return res.status(409).json({ error: 'De teamselectie is gesloten (etappe 1 is gestart)' });

  const riderIds = [...new Set(req.body?.riderIds || [])];
  if (riderIds.length > TEAM_SIZE) return res.status(400).json({ error: `Maximaal ${TEAM_SIZE} renners` });

  const riders = riderIds.map((id) => db.prepare('SELECT * FROM riders WHERE id = ?').get(id));
  if (riders.some((r) => !r)) return res.status(400).json({ error: 'Onbekende renner in selectie' });

  const total = riders.reduce((sum, r) => sum + r.price, 0);
  if (total > BUDGET) return res.status(400).json({ error: 'Budget overschreden' });

  // Genoeg budget overhouden voor de resterende plekken (goedkoopste renner kost € 500.000)
  const remainingSlots = TEAM_SIZE - riders.length;
  if (BUDGET - total < remainingSlots * MIN_RIDER_PRICE) {
    return res.status(400).json({ error: `Je moet minimaal € ${(remainingSlots * MIN_RIDER_PRICE).toLocaleString('nl-NL')} overhouden voor de resterende ${remainingSlots} renners` });
  }

  const perTeam = {};
  for (const r of riders) {
    perTeam[r.team_id] = (perTeam[r.team_id] || 0) + 1;
    if (perTeam[r.team_id] > MAX_PER_CYCLING_TEAM) {
      return res.status(400).json({ error: `Maximaal ${MAX_PER_CYCLING_TEAM} renners per ploeg` });
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_teams WHERE user_id = ?').run(user.id);
    const ins = db.prepare('INSERT INTO user_teams (user_id, rider_id) VALUES (?, ?)');
    for (const id of riderIds) ins.run(user.id, id);
    // Verwijder renners uit opstellingen van nog open etappes als ze niet meer in het team zitten
    db.prepare(`
      DELETE FROM lineups WHERE user_id = ? AND rider_id NOT IN (SELECT rider_id FROM user_teams WHERE user_id = ?)
      AND stage_nr IN (SELECT nr FROM stages WHERE status = 'open')
    `).run(user.id, user.id);
  });
  tx();
  res.json({ ok: true, count: riderIds.length, complete: riderIds.length === TEAM_SIZE });
});

// --- opstelling per etappe ---------------------------------------------------

app.get('/api/lineup/:nr', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const stage = db.prepare('SELECT * FROM stages WHERE nr = ?').get(Number(req.params.nr));
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });
  const rows = db.prepare('SELECT * FROM lineups WHERE user_id = ? AND stage_nr = ?').all(user.id, stage.nr);
  res.json({
    riderIds: rows.map((r) => r.rider_id),
    captainId: rows.find((r) => r.is_captain)?.rider_id ?? null,
    locked: stage.status !== 'open',
    stage,
  });
});

app.put('/api/lineup/:nr', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const stage = db.prepare('SELECT * FROM stages WHERE nr = ?').get(Number(req.params.nr));
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });
  if (stage.status !== 'open') return res.status(409).json({ error: 'Deze etappe is gesloten' });

  const riderIds = [...new Set(req.body?.riderIds || [])];
  const captainId = req.body?.captainId;
  if (riderIds.length !== LINEUP_SIZE) return res.status(400).json({ error: `Stel precies ${LINEUP_SIZE} renners op` });
  if (!captainId || !riderIds.includes(captainId)) return res.status(400).json({ error: 'Wijs een kopman aan (één van je 9 opgestelde renners)' });

  const teamIds = new Set(db.prepare('SELECT rider_id FROM user_teams WHERE user_id = ?').all(user.id).map((r) => r.rider_id));
  if (teamIds.size !== TEAM_SIZE) return res.status(400).json({ error: 'Maak eerst je team van 20 renners compleet' });
  if (riderIds.some((id) => !teamIds.has(id))) return res.status(400).json({ error: 'Je kunt alleen renners uit je eigen team opstellen' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM lineups WHERE user_id = ? AND stage_nr = ?').run(user.id, stage.nr);
    const ins = db.prepare('INSERT INTO lineups (user_id, stage_nr, rider_id, is_captain) VALUES (?, ?, ?, ?)');
    for (const id of riderIds) ins.run(user.id, stage.nr, id, id === captainId ? 1 : 0);
  });
  tx();
  res.json({ ok: true });
});

// --- poules -----------------------------------------------------------------

const poolCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

app.get('/api/pools', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const pools = db.prepare(`
    SELECT p.id, p.name, p.code, p.owner_id,
      (SELECT COUNT(*) FROM pool_members m WHERE m.pool_id = p.id) AS member_count
    FROM pools p JOIN pool_members me ON me.pool_id = p.id AND me.user_id = ?
    ORDER BY p.created_at
  `).all(user.id).map((p) => ({
    id: p.id, name: p.name, memberCount: p.member_count,
    isOwner: p.owner_id === user.id, code: p.owner_id === user.id ? p.code : undefined,
  }));
  res.json({ pools });
});

app.post('/api/pools', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Geef een naam op' });
  let code = poolCode();
  while (db.prepare('SELECT 1 FROM pools WHERE code = ?').get(code)) code = poolCode();
  const info = db.prepare('INSERT INTO pools (name, code, owner_id) VALUES (?, ?, ?)').run(name, code, user.id);
  db.prepare('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, user.id);
  res.json({ id: info.lastInsertRowid, name, code });
});

app.post('/api/pools/join', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const code = (req.body?.code || '').trim().toUpperCase();
  const pool = db.prepare('SELECT * FROM pools WHERE code = ?').get(code);
  if (!pool) return res.status(404).json({ error: 'Poule niet gevonden — controleer de code' });
  db.prepare('INSERT OR IGNORE INTO pool_members (pool_id, user_id) VALUES (?, ?)').run(pool.id, user.id);
  res.json({ id: pool.id, name: pool.name });
});

app.post('/api/pools/:id/leave', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  db.prepare('DELETE FROM pool_members WHERE pool_id = ? AND user_id = ?').run(Number(req.params.id), user.id);
  res.json({ ok: true });
});

// --- klassementen -----------------------------------------------------------

app.get('/api/ranking', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const poolId = req.query.poolId ? Number(req.query.poolId) : null;

  let userFilter = '';
  const params = [];
  if (poolId) {
    userFilter = 'AND u.id IN (SELECT user_id FROM pool_members WHERE pool_id = ?)';
    params.push(poolId);
  }
  const lastFinished = db.prepare("SELECT MAX(nr) AS m FROM stages WHERE status = 'finished'").get().m || 0;

  const rows = db.prepare(`
    SELECT u.id, u.name, u.created_at,
      COALESCE((SELECT SUM(points) FROM user_scores s WHERE s.user_id = u.id), 0) AS total,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = ?), 0) AS last_stage,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = 0), 0) AS final_points
    FROM users u
    WHERE 1=1 ${userFilter}
    ORDER BY total DESC, u.created_at ASC
  `).all(lastFinished, ...params);

  res.json({
    lastFinishedStage: lastFinished || null,
    ranking: rows.map((r, i) => ({
      position: i + 1, userId: r.id, name: r.name,
      total: r.total, lastStage: r.last_stage, finalPoints: r.final_points,
      isMe: r.id === user.id,
    })),
  });
});

app.get('/api/my/points', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const scores = db.prepare('SELECT * FROM user_scores WHERE user_id = ? ORDER BY stage_nr').all(user.id);
  res.json({ scores: scores.map((s) => ({ stageNr: s.stage_nr, points: s.points })) });
});

app.get('/api/my/points/:nr', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const isFinal = nr === 0;

  const lineup = isFinal
    ? db.prepare('SELECT rider_id, 0 AS is_captain FROM user_teams WHERE user_id = ?').all(user.id)
    : db.prepare('SELECT rider_id, is_captain FROM lineups WHERE user_id = ? AND stage_nr = ?').all(user.id, nr);

  const breakdown = lineup.map((l) => {
    const rider = db.prepare('SELECT r.*, t.name AS team_name FROM riders r JOIN cycling_teams t ON t.id = r.team_id WHERE r.id = ?').get(l.rider_id);
    const pts = db.prepare('SELECT category, points FROM rider_points WHERE stage_nr = ? AND rider_id = ?').all(nr, l.rider_id);
    const get = (cat) => pts.find((p) => p.category === cat)?.points || 0;
    const stagePts = get('stage') * (l.is_captain ? 2 : 1);
    return {
      riderId: rider.id, name: rider.name, team: rider.team_name,
      isCaptain: !!l.is_captain,
      stagePoints: stagePts, classPoints: get('class'), teamPoints: get('team'),
      total: stagePts + get('class') + get('team'),
    };
  }).sort((a, b) => b.total - a.total);

  res.json({ stageNr: nr, breakdown, total: breakdown.reduce((s, b) => s + b.total, 0) });
});

// --- admin ------------------------------------------------------------------

app.get('/api/admin/overview', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const stages = db.prepare('SELECT * FROM stages ORDER BY nr').all().map((s) => ({
    ...s,
    hasResult: s.type === 'TTT'
      ? !!db.prepare('SELECT 1 FROM ttt_results WHERE stage_nr = ? LIMIT 1').get(s.nr)
      : !!db.prepare('SELECT 1 FROM stage_results WHERE stage_nr = ? LIMIT 1').get(s.nr),
  }));
  const finalDone = !!db.prepare('SELECT 1 FROM final_standings LIMIT 1').get();
  res.json({ stages, finalDone });
});

app.put('/api/admin/stage/:nr/status', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const { status } = req.body || {};
  if (!['open', 'started', 'finished'].includes(status)) return res.status(400).json({ error: 'Ongeldige status' });
  db.prepare('UPDATE stages SET status = ? WHERE nr = ?').run(status, Number(req.params.nr));
  res.json({ ok: true });
});

app.get('/api/admin/stage/:nr/result', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const positions = db.prepare('SELECT position, rider_id FROM stage_results WHERE stage_nr = ? ORDER BY position').all(nr);
  const tttPositions = db.prepare('SELECT position, team_id FROM ttt_results WHERE stage_nr = ? ORDER BY position').all(nr);
  const standings = db.prepare('SELECT classification, position, rider_id FROM classification_standings WHERE stage_nr = ?').all(nr);
  const classifications = {};
  for (const cls of CLASSIFICATIONS) {
    classifications[cls] = standings.filter((s) => s.classification === cls).sort((a, b) => a.position - b.position)
      .reduce((arr, s) => { arr[s.position - 1] = s.rider_id; return arr; }, []);
  }
  res.json({ positions, tttPositions, classifications });
});

app.put('/api/admin/stage/:nr/result', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const stage = db.prepare('SELECT * FROM stages WHERE nr = ?').get(nr);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });

  const { positions = [], tttPositions = [], classifications = {} } = req.body || {};
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM stage_results WHERE stage_nr = ?').run(nr);
    db.prepare('DELETE FROM ttt_results WHERE stage_nr = ?').run(nr);
    db.prepare('DELETE FROM classification_standings WHERE stage_nr = ?').run(nr);

    if (stage.type === 'TTT') {
      const ins = db.prepare('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (?, ?, ?)');
      for (const p of tttPositions) if (p.teamId) ins.run(nr, p.position, p.teamId);
    } else {
      const ins = db.prepare('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (?, ?, ?)');
      for (const p of positions) if (p.riderId) ins.run(nr, p.position, p.riderId);
    }

    const insCls = db.prepare('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (?, ?, ?, ?)');
    for (const cls of CLASSIFICATIONS) {
      (classifications[cls] || []).forEach((riderId, i) => {
        if (riderId) insCls.run(nr, cls, i + 1, riderId);
      });
    }
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/admin/stage/:nr/process', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  try {
    processStage(Number(req.params.nr));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/admin/final', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const standings = db.prepare('SELECT classification, position, rider_id FROM final_standings').all();
  const result = {};
  for (const cls of CLASSIFICATIONS) {
    result[cls] = standings.filter((s) => s.classification === cls).sort((a, b) => a.position - b.position)
      .reduce((arr, s) => { arr[s.position - 1] = s.rider_id; return arr; }, []);
  }
  res.json({ standings: result, sizes: Object.fromEntries(CLASSIFICATIONS.map((c) => [c, FINAL_POINTS[c].length])) });
});

app.put('/api/admin/final', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const standings = req.body?.standings || {};
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM final_standings').run();
    const ins = db.prepare('INSERT INTO final_standings (classification, position, rider_id) VALUES (?, ?, ?)');
    for (const cls of CLASSIFICATIONS) {
      (standings[cls] || []).forEach((riderId, i) => {
        if (riderId) ins.run(cls, i + 1, riderId);
      });
    }
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/admin/final/process', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  processFinal();
  res.json({ ok: true });
});

app.put('/api/admin/rider/:id/withdrawn', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  const lastStartedStage = req.body?.lastStartedStage ?? null;
  db.prepare('UPDATE riders SET last_started_stage = ? WHERE id = ?').run(lastStartedStage, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/teams', (req, res) => {
  const user = requireAdmin(req, res); if (!user) return;
  res.json({ teams: db.prepare('SELECT * FROM cycling_teams ORDER BY name').all() });
});

// --- productie: geserveerde frontend ----------------------------------------
// In productie serveert deze ene Node-service ook de gebouwde React-app
// (client/dist), zodat alles op één poort/URL draait. In dev gebruik je Vite (:5173).
const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA-fallback: alle niet-/api routes naar index.html (client-side routing)
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Snorito draait op http://localhost:${PORT}`));
