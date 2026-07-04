import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  get, all, run, tx,
  BUDGET, TEAM_SIZE, MAX_PER_CYCLING_TEAM, LINEUP_SIZE, MIN_RIDER_PRICE, CAPTAIN_FACTOR,
} from './db.js';
import {
  processStage, processFinal, CLASSIFICATIONS, FINAL_POINTS,
  STAGE_POINTS, TTT_POINTS, CLASS_POINTS_AFTER_STAGE, TEAM_POINTS_AFTER_STAGE, FINAL_TEAM_POINTS,
} from './points.js';
import { ensureSeeded } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Op een verse host is de database leeg — vul hem dan met renners, etappes en demo-data.
await ensureSeeded();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Async-handlerwrapper: onverwachte fouten netjes als 500 i.p.v. hangend request.
const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'Serverfout' });
});

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

async function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return await get(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [token]
  ) || null;
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: 'Niet ingelogd' }); return null; }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (user && !user.is_admin) { res.status(403).json({ error: 'Geen beheerder' }); return null; }
  return user;
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);
  const header = cookie('session', token, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'Lax',
    secure: isProduction(),
  });
  res.setHeader('Set-Cookie', header);
  return header;
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatar_url || null,
  isAdmin: !!u.is_admin,
});

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}

function appUrl(req) {
  return (
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get('host')}` ||
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

function googleRedirectUri(req) {
  return `${appUrl(req)}/api/auth/google/callback`;
}

function googleAuthConfigured() {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

// --- auth routes ------------------------------------------------------------

app.get('/api/auth/google', (req, res) => {
  if (!googleAuthConfigured()) {
    return res.status(500).send('Google login is niet geconfigureerd');
  }

  const state = crypto.randomBytes(24).toString('hex');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.setHeader(
    'Set-Cookie',
    cookie('google_oauth_state', state, {
      httpOnly: true,
      path: '/',
      maxAge: 60 * 10,
      sameSite: 'Lax',
      secure: isProduction(),
    })
  );

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', ah(async (req, res) => {
  try {
    if (!googleAuthConfigured()) {
      return res.status(500).send('Google login is niet geconfigureerd');
    }

    const { code, state, error } = req.query;

    if (error) {
      return res.redirect('/login?error=google');
    }

    const cookies = parseCookies(req);

    if (!state || !cookies.google_oauth_state || state !== cookies.google_oauth_state) {
      return res.status(400).send('Ongeldige Google login state');
    }

    if (!code) {
      return res.status(400).send('Google code ontbreekt');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google token error:', tokenData);
      return res.redirect('/login?error=google');
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const googleUser = await userInfoResponse.json();

    if (!userInfoResponse.ok) {
      console.error('Google userinfo error:', googleUser);
      return res.redirect('/login?error=google');
    }

    const googleId = googleUser.sub;
    const email = googleUser.email;
    const name = googleUser.name || email;
    const avatarUrl = googleUser.picture || null;

    if (!googleId || !email) {
      return res.redirect('/login?error=google');
    }

    let user =
      await get('SELECT * FROM users WHERE google_id = ?', [googleId]) ||
      await get('SELECT * FROM users WHERE email = ?', [email]);

    if (user) {
      await run(
        'UPDATE users SET google_id = ?, name = ?, avatar_url = ? WHERE id = ?',
        [googleId, name, avatarUrl, user.id]
      );
      user = await get('SELECT * FROM users WHERE id = ?', [user.id]);
    } else {
      const row = await get(
        'INSERT INTO users (name, email, pass_hash, salt, google_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        [name, email, '', '', googleId, avatarUrl]
      );
      user = await get('SELECT * FROM users WHERE id = ?', [row.id]);
    }

    const sessionCookie = await startSession(res, user.id);

    res.setHeader('Set-Cookie', [
      sessionCookie,
      cookie('google_oauth_state', '', {
        httpOnly: true,
        path: '/',
        maxAge: 0,
        sameSite: 'Lax',
        secure: isProduction(),
      }),
    ]);

    res.redirect('/');
  } catch (e) {
    console.error('Google login callback error:', e);
    res.redirect('/login?error=google');
  }
}));

app.post('/api/auth/register', ah(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Naam, e-mail en wachtwoord zijn verplicht' });
  if (await get('SELECT 1 FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: 'E-mailadres is al in gebruik' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const row = await get(
    'INSERT INTO users (name, email, pass_hash, salt) VALUES (?, ?, ?, ?) RETURNING id',
    [name, email, hashPassword(password, salt), salt]
  );
  await startSession(res, row.id);
  res.json({ user: publicUser(await get('SELECT * FROM users WHERE id = ?', [row.id])) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE email = ?', [email || '']);
  if (!user || hashPassword(password || '', user.salt) !== user.pass_hash) {
    return res.status(401).json({ error: 'Onjuiste inloggegevens' });
  }
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', ah(async (req, res) => {
  const token = parseCookies(req).session;
  if (token) await run('DELETE FROM sessions WHERE token = ?', [token]);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

app.get('/api/me', ah(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.json({ user: null });
  const teamCount = (await get('SELECT COUNT(*) AS c FROM user_teams WHERE user_id = ?', [user.id])).c;
  res.json({ user: publicUser(user), teamCount, teamComplete: teamCount === TEAM_SIZE });
}));

// --- basisdata --------------------------------------------------------------

app.get('/api/riders', ah(async (_req, res) => {
  const riders = (await all(`
    SELECT r.*, t.name AS team_name, t.abbreviation AS team_abbr, t.shirt_url AS team_shirt
    FROM riders r JOIN cycling_teams t ON t.id = r.team_id
    ORDER BY r.price DESC, r.name
  `)).map((r) => ({ ...r, qualities: JSON.parse(r.qualities) }));
  res.json({ riders, budget: BUDGET, teamSize: TEAM_SIZE, maxPerTeam: MAX_PER_CYCLING_TEAM });
}));

app.get('/api/teams', ah(async (_req, res) => {
  const teams = await all(`
    SELECT t.id, t.name, t.abbreviation AS abbr, t.shirt_url AS shirt,
      COUNT(r.id) AS rider_count,
      MIN(r.price) AS min_price
    FROM cycling_teams t LEFT JOIN riders r ON r.team_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `);
  res.json({ teams });
}));

app.get('/api/stages', ah(async (_req, res) => {
  res.json({ stages: await all('SELECT * FROM stages ORDER BY nr') });
}));

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

const teamLocked = async () =>
  (await get('SELECT status FROM stages WHERE nr = 1'))?.status !== 'open';

app.get('/api/team', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const riderIds = (await all('SELECT rider_id FROM user_teams WHERE user_id = ?', [user.id])).map((r) => r.rider_id);
  res.json({ riderIds, locked: await teamLocked() });
}));

app.put('/api/team', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (await teamLocked()) return res.status(409).json({ error: 'De teamselectie is gesloten (etappe 1 is gestart)' });

  const riderIds = [...new Set(req.body?.riderIds || [])];
  if (riderIds.length > TEAM_SIZE) return res.status(400).json({ error: `Maximaal ${TEAM_SIZE} renners` });

  const riders = [];
  for (const id of riderIds) riders.push(await get('SELECT * FROM riders WHERE id = ?', [id]));
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

  await tx(async (h) => {
    await h.run('DELETE FROM user_teams WHERE user_id = ?', [user.id]);
    for (const id of riderIds) await h.run('INSERT INTO user_teams (user_id, rider_id) VALUES (?, ?)', [user.id, id]);
    // Verwijder renners uit opstellingen van nog open etappes als ze niet meer in het team zitten
    await h.run(`
      DELETE FROM lineups WHERE user_id = ? AND rider_id NOT IN (SELECT rider_id FROM user_teams WHERE user_id = ?)
      AND stage_nr IN (SELECT nr FROM stages WHERE status = 'open')
    `, [user.id, user.id]);
  });
  res.json({ ok: true, count: riderIds.length, complete: riderIds.length === TEAM_SIZE });
}));

// --- opstelling per etappe ---------------------------------------------------

app.get('/api/lineup/:nr', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [Number(req.params.nr)]);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });
  const rows = await all('SELECT * FROM lineups WHERE user_id = ? AND stage_nr = ?', [user.id, stage.nr]);
  res.json({
    riderIds: rows.map((r) => r.rider_id),
    captainId: rows.find((r) => r.is_captain)?.rider_id ?? null,
    locked: stage.status !== 'open',
    stage,
  });
}));

app.put('/api/lineup/:nr', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [Number(req.params.nr)]);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });
  if (stage.status !== 'open') return res.status(409).json({ error: 'Deze etappe is gesloten' });

  const riderIds = [...new Set(req.body?.riderIds || [])];
  const captainId = req.body?.captainId;
  if (riderIds.length !== LINEUP_SIZE) return res.status(400).json({ error: `Stel precies ${LINEUP_SIZE} renners op` });
  if (!captainId || !riderIds.includes(captainId)) return res.status(400).json({ error: 'Wijs een kopman aan (één van je 9 opgestelde renners)' });

  const teamIds = new Set((await all('SELECT rider_id FROM user_teams WHERE user_id = ?', [user.id])).map((r) => r.rider_id));
  if (teamIds.size !== TEAM_SIZE) return res.status(400).json({ error: 'Maak eerst je team van 20 renners compleet' });
  if (riderIds.some((id) => !teamIds.has(id))) return res.status(400).json({ error: 'Je kunt alleen renners uit je eigen team opstellen' });

  await tx(async (h) => {
    await h.run('DELETE FROM lineups WHERE user_id = ? AND stage_nr = ?', [user.id, stage.nr]);
    for (const id of riderIds) {
      await h.run('INSERT INTO lineups (user_id, stage_nr, rider_id, is_captain) VALUES (?, ?, ?, ?)', [user.id, stage.nr, id, id === captainId ? 1 : 0]);
    }
  });
  res.json({ ok: true });
}));

// --- poules -----------------------------------------------------------------

const poolCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

app.get('/api/pools', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const pools = (await all(`
    SELECT p.id, p.name, p.code, p.owner_id,
      (SELECT COUNT(*) FROM pool_members m WHERE m.pool_id = p.id) AS member_count
    FROM pools p JOIN pool_members me ON me.pool_id = p.id AND me.user_id = ?
    ORDER BY p.created_at
  `, [user.id])).map((p) => ({
    id: p.id, name: p.name, memberCount: p.member_count,
    isOwner: p.owner_id === user.id, code: p.owner_id === user.id ? p.code : undefined,
  }));
  res.json({ pools });
}));

app.post('/api/pools', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Geef een naam op' });
  let code = poolCode();
  while (await get('SELECT 1 FROM pools WHERE code = ?', [code])) code = poolCode();
  const row = await get('INSERT INTO pools (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', [name, code, user.id]);
  await run('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)', [row.id, user.id]);
  res.json({ id: row.id, name, code });
}));

app.post('/api/pools/join', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const code = (req.body?.code || '').trim().toUpperCase();
  const pool = await get('SELECT * FROM pools WHERE code = ?', [code]);
  if (!pool) return res.status(404).json({ error: 'Poule niet gevonden — controleer de code' });
  await run('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [pool.id, user.id]);
  res.json({ id: pool.id, name: pool.name });
}));

app.post('/api/pools/:id/leave', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  await run('DELETE FROM pool_members WHERE pool_id = ? AND user_id = ?', [Number(req.params.id), user.id]);
  res.json({ ok: true });
}));

// --- klassementen -----------------------------------------------------------

app.get('/api/ranking', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const poolId = req.query.poolId ? Number(req.query.poolId) : null;

  let userFilter = '';
  const params = [];
  if (poolId) {
    userFilter = 'AND u.id IN (SELECT user_id FROM pool_members WHERE pool_id = ?)';
    params.push(poolId);
  }
  const lastFinished = (await get("SELECT MAX(nr) AS m FROM stages WHERE status = 'finished'")).m || 0;

  const rows = await all(`
    SELECT u.id, u.name, u.created_at,
      COALESCE((SELECT SUM(points) FROM user_scores s WHERE s.user_id = u.id), 0) AS total,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = ?), 0) AS last_stage,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = 0), 0) AS final_points
    FROM users u
    WHERE 1=1 ${userFilter}
    ORDER BY total DESC, u.created_at ASC
  `, [lastFinished, ...params]);

  res.json({
    lastFinishedStage: lastFinished || null,
    ranking: rows.map((r, i) => ({
      position: i + 1, userId: r.id, name: r.name,
      total: r.total, lastStage: r.last_stage, finalPoints: r.final_points,
      isMe: r.id === user.id,
    })),
  });
}));

app.get('/api/my/points', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const scores = await all('SELECT * FROM user_scores WHERE user_id = ? ORDER BY stage_nr', [user.id]);
  res.json({ scores: scores.map((s) => ({ stageNr: s.stage_nr, points: s.points })) });
}));

app.get('/api/my/points/:nr', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const isFinal = nr === 0;

  const lineup = isFinal
    ? await all('SELECT rider_id, 0 AS is_captain FROM user_teams WHERE user_id = ?', [user.id])
    : await all('SELECT rider_id, is_captain FROM lineups WHERE user_id = ? AND stage_nr = ?', [user.id, nr]);

  const breakdown = [];
  for (const l of lineup) {
    const rider = await get('SELECT r.*, t.name AS team_name FROM riders r JOIN cycling_teams t ON t.id = r.team_id WHERE r.id = ?', [l.rider_id]);
    const pts = await all('SELECT category, points FROM rider_points WHERE stage_nr = ? AND rider_id = ?', [nr, l.rider_id]);
    const getPts = (cat) => pts.find((p) => p.category === cat)?.points || 0;
    const stagePts = getPts('stage') * (l.is_captain ? 2 : 1);
    breakdown.push({
      riderId: rider.id, name: rider.name, team: rider.team_name,
      isCaptain: !!l.is_captain,
      stagePoints: stagePts, classPoints: getPts('class'), teamPoints: getPts('team'),
      total: stagePts + getPts('class') + getPts('team'),
    });
  }
  breakdown.sort((a, b) => b.total - a.total);

  res.json({ stageNr: nr, breakdown, total: breakdown.reduce((s, b) => s + b.total, 0) });
}));

// --- admin ------------------------------------------------------------------

app.get('/api/admin/overview', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const stages = [];
  for (const s of await all('SELECT * FROM stages ORDER BY nr')) {
    stages.push({
      ...s,
      hasResult: s.type === 'TTT'
        ? !!(await get('SELECT 1 FROM ttt_results WHERE stage_nr = ? LIMIT 1', [s.nr]))
        : !!(await get('SELECT 1 FROM stage_results WHERE stage_nr = ? LIMIT 1', [s.nr])),
    });
  }
  const finalDone = !!(await get('SELECT 1 FROM final_standings LIMIT 1'));
  res.json({ stages, finalDone });
}));

app.put('/api/admin/stage/:nr/status', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const { status } = req.body || {};
  if (!['open', 'started', 'finished'].includes(status)) return res.status(400).json({ error: 'Ongeldige status' });
  await run('UPDATE stages SET status = ? WHERE nr = ?', [status, Number(req.params.nr)]);
  res.json({ ok: true });
}));

app.get('/api/admin/stage/:nr/result', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const positions = await all('SELECT position, rider_id FROM stage_results WHERE stage_nr = ? ORDER BY position', [nr]);
  const tttPositions = await all('SELECT position, team_id FROM ttt_results WHERE stage_nr = ? ORDER BY position', [nr]);
  const standings = await all('SELECT classification, position, rider_id FROM classification_standings WHERE stage_nr = ?', [nr]);
  const classifications = {};
  for (const cls of CLASSIFICATIONS) {
    classifications[cls] = standings.filter((s) => s.classification === cls).sort((a, b) => a.position - b.position)
      .reduce((arr, s) => { arr[s.position - 1] = s.rider_id; return arr; }, []);
  }
  res.json({ positions, tttPositions, classifications });
}));

app.put('/api/admin/stage/:nr/result', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [nr]);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });

  const { positions = [], tttPositions = [], classifications = {} } = req.body || {};
  await tx(async (h) => {
    await h.run('DELETE FROM stage_results WHERE stage_nr = ?', [nr]);
    await h.run('DELETE FROM ttt_results WHERE stage_nr = ?', [nr]);
    await h.run('DELETE FROM classification_standings WHERE stage_nr = ?', [nr]);

    if (stage.type === 'TTT') {
      for (const p of tttPositions) {
        if (p.teamId) await h.run('INSERT INTO ttt_results (stage_nr, position, team_id) VALUES (?, ?, ?)', [nr, p.position, p.teamId]);
      }
    } else {
      for (const p of positions) {
        if (p.riderId) await h.run('INSERT INTO stage_results (stage_nr, position, rider_id) VALUES (?, ?, ?)', [nr, p.position, p.riderId]);
      }
    }

    for (const cls of CLASSIFICATIONS) {
      const arr = classifications[cls] || [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]) await h.run('INSERT INTO classification_standings (stage_nr, classification, position, rider_id) VALUES (?, ?, ?, ?)', [nr, cls, i + 1, arr[i]]);
      }
    }
  });
  res.json({ ok: true });
}));

app.post('/api/admin/stage/:nr/process', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  try {
    await processStage(Number(req.params.nr));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.get('/api/admin/final', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const standings = await all('SELECT classification, position, rider_id FROM final_standings');
  const result = {};
  for (const cls of CLASSIFICATIONS) {
    result[cls] = standings.filter((s) => s.classification === cls).sort((a, b) => a.position - b.position)
      .reduce((arr, s) => { arr[s.position - 1] = s.rider_id; return arr; }, []);
  }
  res.json({ standings: result, sizes: Object.fromEntries(CLASSIFICATIONS.map((c) => [c, FINAL_POINTS[c].length])) });
}));

app.put('/api/admin/final', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const standings = req.body?.standings || {};
  await tx(async (h) => {
    await h.run('DELETE FROM final_standings');
    for (const cls of CLASSIFICATIONS) {
      const arr = standings[cls] || [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i]) await h.run('INSERT INTO final_standings (classification, position, rider_id) VALUES (?, ?, ?)', [cls, i + 1, arr[i]]);
      }
    }
  });
  res.json({ ok: true });
}));

app.post('/api/admin/final/process', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  await processFinal();
  res.json({ ok: true });
}));

app.put('/api/admin/rider/:id/withdrawn', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const lastStartedStage = req.body?.lastStartedStage ?? null;
  await run('UPDATE riders SET last_started_stage = ? WHERE id = ?', [lastStartedStage, Number(req.params.id)]);
  res.json({ ok: true });
}));

app.get('/api/admin/teams', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  res.json({ teams: await all('SELECT * FROM cycling_teams ORDER BY name') });
}));

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
