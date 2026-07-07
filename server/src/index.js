import express from 'express';
import compression from 'compression';
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
import { runSync, syncTick, importStageHtml, importLetourRankings, noteSyncError, saveStageResult } from './sync.js';
import { sendPasswordResetMail } from './mail.js';
import { rateLimit } from './ratelimit.js';
import { cached, bustCache } from './cache.js';
import { checkLineupReminders } from './reminders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Op een verse host is de database leeg — vul hem dan met renners, etappes en demo-data.
await ensureSeeded();

const app = express();
app.set('trust proxy', 1);
app.use(compression());

// Basis-security-headers: niet in frames laden (clickjacking), geen MIME-sniffing,
// geen referrer naar externe sites, en in productie HTTPS afdwingen (HSTS).
// Bewust geen Content-Security-Policy: die kan de Vite/PWA-bundel breken en
// vergt apart testwerk — niet doen tijdens een lopende Tour.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (isProduction()) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// Ruime limiet: de PCS-sync levert complete etappepagina's (±1 MB) aan als JSON.
app.use(express.json({ limit: '5mb' }));

// Keep-alive-bestemming: een externe pinger (GitHub Action + cron-job.org) raakt
// deze elke paar minuten aan zodat Render de free-instantie niet in slaap legt
// (spin-down na 15 min inactiviteit → cold start van tientallen seconden). Geen
// database, geen werk — puur een levensteken. Staat bewust vóór de SPA-fallback.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

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

    await run('UPDATE users SET last_login_at = now() WHERE id = ?', [user.id]);
    await run('INSERT INTO login_events (user_id, method) VALUES (?, ?)', [user.id, 'google']);
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
  if (!rateLimit(`register:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Te veel registraties vanaf dit adres — probeer het later opnieuw' });
  }
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
  await run('INSERT INTO login_events (user_id, method) VALUES (?, ?)', [row.id, 'registratie']);
  await startSession(res, row.id);
  res.json({ user: publicUser(await get('SELECT * FROM users WHERE id = ?', [row.id])) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  if (!rateLimit(`login:${req.ip}`, 20, 15 * 60_000)) {
    return res.status(429).json({ error: 'Te veel inlogpogingen — probeer het later opnieuw' });
  }
  const { email, password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE email = ?', [email || '']);
  if (!user || hashPassword(password || '', user.salt) !== user.pass_hash) {
    return res.status(401).json({ error: 'Onjuiste inloggegevens' });
  }
  await run('UPDATE users SET last_login_at = now() WHERE id = ?', [user.id]);
  await run('INSERT INTO login_events (user_id, method) VALUES (?, ?)', [user.id, 'e-mail']);
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

app.post('/api/auth/forgot', ah(async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const generic = { ok: true }; // altijd hetzelfde antwoord — verraadt niet of het adres bestaat
  if (!email) return res.json(generic);
  if (!rateLimit(`forgot-ip:${req.ip}`, 10, 15 * 60_000)) return res.json(generic);
  if (!rateLimit(`forgot:${email}`, 3, 15 * 60_000)) return res.json(generic);

  const user = await get('SELECT * FROM users WHERE lower(email) = ?', [email]);
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await run(
    "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, now() + interval '1 hour')",
    [user.id, sha256(token)]
  );
  try {
    await sendPasswordResetMail(user.email, `${appUrl(req)}/reset?token=${token}`);
  } catch (e) {
    console.error('Mailfout bij wachtwoord-reset:', e.message);
  }
  res.json(generic);
}));

app.post('/api/auth/reset', ah(async (req, res) => {
  if (!rateLimit(`reset:${req.ip}`, 10, 15 * 60_000)) {
    return res.status(429).json({ error: 'Te veel pogingen — probeer het later opnieuw' });
  }
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens zijn' });
  }
  const row = await get(
    'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()',
    [sha256(token)]
  );
  if (!row) return res.status(400).json({ error: 'Deze link is ongeldig of verlopen — vraag een nieuwe aan' });

  const salt = crypto.randomBytes(16).toString('hex');
  await tx(async (h) => {
    await h.run('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?', [hashPassword(password, salt), salt, row.user_id]);
    await h.run('UPDATE password_resets SET used_at = now() WHERE id = ?', [row.id]);
    await h.run('DELETE FROM sessions WHERE user_id = ?', [row.user_id]); // oude sessies zijn niet meer te vertrouwen
  });
  res.json({ ok: true });
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

// Basisdata is voor iedereen gelijk en verandert alleen bij imports of
// admin-wijzigingen — servercache (zie cache.js) scheelt Neon-roundtrips.
app.get('/api/riders', ah(async (_req, res) => {
  const riders = await cached('riders', 30_000, async () => (await all(`
    SELECT r.*, t.name AS team_name, t.abbreviation AS team_abbr, t.shirt_url AS team_shirt
    FROM riders r JOIN cycling_teams t ON t.id = r.team_id
    ORDER BY r.price DESC, r.name
  `)).map((r) => ({ ...r, qualities: JSON.parse(r.qualities) })));
  res.json({ riders, budget: BUDGET, teamSize: TEAM_SIZE, maxPerTeam: MAX_PER_CYCLING_TEAM });
}));

app.get('/api/teams', ah(async (_req, res) => {
  const teams = await cached('teams', 30_000, () => all(`
    SELECT t.id, t.name, t.abbreviation AS abbr, t.shirt_url AS shirt,
      COUNT(r.id) AS rider_count,
      MIN(r.price) AS min_price
    FROM cycling_teams t LEFT JOIN riders r ON r.team_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `));
  res.json({ teams });
}));

app.get('/api/stages', ah(async (_req, res) => {
  res.json({ stages: await cached('stages', 15_000, () => all('SELECT * FROM stages ORDER BY nr')) });
}));

// Huidige stand in de vier klassementen (na de laatst verwerkte etappe), als
// map rider_id -> { alg, punt, berg, jong } positie. Voor de trui-badges bij de
// opstelling. Gecachet; bustCache() bij elke nieuwe uitslag.
app.get('/api/classifications/current', ah(async (_req, res) => {
  const data = await cached('classifications-current', 30_000, async () => {
    const last = (await get("SELECT MAX(nr) AS m FROM stages WHERE status = 'finished'")).m || null;
    const byRider = {};
    if (last) {
      const rows = await all('SELECT classification, position, rider_id FROM classification_standings WHERE stage_nr = ?', [last]);
      for (const r of rows) (byRider[r.rider_id] ||= {})[r.classification] = r.position;
    }
    return { stageNr: last, byRider };
  });
  res.json(data);
}));

// Resultaten van één renner over alle verwerkte etappes: finishpositie en
// punten (rit/klass./team/totaal). Voor het uitklappen bij de opstelling.
app.get('/api/rider/:id/results', ah(async (req, res) => {
  const id = Number(req.params.id);
  const stages = await all("SELECT nr, van, naar, type FROM stages WHERE status = 'finished' ORDER BY nr");
  const posByStage = new Map((await all('SELECT stage_nr, position FROM stage_results WHERE rider_id = ?', [id])).map((r) => [r.stage_nr, r.position]));
  const ptsByStage = new Map();
  for (const p of await all('SELECT stage_nr, category, points FROM rider_points WHERE rider_id = ?', [id])) {
    const cur = ptsByStage.get(p.stage_nr) || {};
    cur[p.category] = p.points;
    ptsByStage.set(p.stage_nr, cur);
  }
  const results = stages.map((s) => {
    const pts = ptsByStage.get(s.nr) || {};
    const stagePoints = pts.stage || 0, classPoints = pts.class || 0, teamPoints = pts.team || 0;
    return {
      stageNr: s.nr, van: s.van, naar: s.naar, type: s.type,
      position: posByStage.get(s.nr) ?? null,
      stagePoints, classPoints, teamPoints, total: stagePoints + classPoints + teamPoints,
    };
  });
  res.json({ results });
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

// Na de Tourstart zijn complete teams definitief, maar late aanmelders mogen
// hun (nog incomplete) team altijd afmaken — zij scoren simpelweg pas vanaf de
// eerstvolgende etappe die nog open staat.
const tourStarted = async () =>
  (await get('SELECT status FROM stages WHERE nr = 1'))?.status !== 'open';

app.get('/api/team', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const riderIds = (await all('SELECT rider_id FROM user_teams WHERE user_id = ?', [user.id])).map((r) => r.rider_id);
  const started = await tourStarted();
  res.json({ riderIds, locked: started && riderIds.length === TEAM_SIZE, tourStarted: started });
}));

app.put('/api/team', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (await tourStarted()) {
    const count = (await get('SELECT COUNT(*) AS c FROM user_teams WHERE user_id = ?', [user.id])).c;
    if (count === TEAM_SIZE) {
      return res.status(409).json({ error: 'Je team is definitief — de Tour is begonnen' });
    }
  }

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

  // Eerstvolgende open etappe + wie daarvoor al een complete opstelling heeft
  // (9 renners). Voor iedereen zichtbaar — alleen het feit, niet de inhoud.
  const nextOpen = (await get("SELECT MIN(nr) AS m FROM stages WHERE status = 'open'")).m || null;
  const readySet = new Set();
  if (nextOpen) {
    const ready = await all(
      'SELECT user_id FROM lineups WHERE stage_nr = ? GROUP BY user_id HAVING COUNT(*) = ?',
      [nextOpen, LINEUP_SIZE]
    );
    for (const r of ready) readySet.add(r.user_id);
  }

  const rows = await all(`
    SELECT u.id, u.name, u.created_at,
      COALESCE((SELECT SUM(points) FROM user_scores s WHERE s.user_id = u.id), 0) AS total,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = ?), 0) AS last_stage,
      COALESCE((SELECT points FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr = 0), 0) AS final_points,
      COALESCE((SELECT SUM(points) FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr > 0), 0) AS stage_points,
      COALESCE((SELECT SUM(optimal_points) FROM user_scores s WHERE s.user_id = u.id AND s.stage_nr > 0), 0) AS optimal_points
    FROM users u
    WHERE 1=1 ${userFilter}
    ORDER BY total DESC, u.created_at ASC
  `, [lastFinished, ...params]);

  res.json({
    lastFinishedStage: lastFinished || null,
    nextStageNr: nextOpen,
    ranking: rows.map((r, i) => ({
      position: i + 1, userId: r.id, name: r.name,
      total: r.total, lastStage: r.last_stage, finalPoints: r.final_points,
      isMe: r.id === user.id,
      lineupReady: readySet.has(r.id),
      // "Raak gekozen?": behaald t.o.v. optimaal haalbaar (bank + kopman) in PUNTEN
      // (niet in aantal juist opgestelde renners), alleen over etappes. Eén cijfer
      // achter de komma.
      efficiency: r.optimal_points > 0 ? Math.round((r.stage_points / r.optimal_points) * 1000) / 10 : null,
    })),
  });
}));

app.get('/api/my/points', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const scores = await all('SELECT * FROM user_scores WHERE user_id = ? ORDER BY stage_nr', [user.id]);
  res.json({ scores: scores.map((s) => ({ stageNr: s.stage_nr, points: s.points })) });
}));

// Puntenuitsplitsing van één deelnemer voor één etappe (nr 0 = eindklassement).
// Set-based: 2 query's in plaats van 2 per opgestelde renner.
async function pointsBreakdown(userId, nr) {
  const isFinal = nr === 0;
  const lineup = isFinal
    ? await all('SELECT rider_id, 0 AS is_captain FROM user_teams WHERE user_id = ?', [userId])
    : await all('SELECT rider_id, is_captain FROM lineups WHERE user_id = ? AND stage_nr = ?', [userId, nr]);
  if (!lineup.length) return { stageNr: nr, breakdown: [], total: 0 };

  const ids = lineup.map((l) => l.rider_id);
  const ph = ids.map(() => '?').join(',');
  const riderRows = await all(
    `SELECT r.id, r.name, r.nationality, r.type, t.name AS team_name, t.shirt_url AS team_shirt
     FROM riders r JOIN cycling_teams t ON t.id = r.team_id WHERE r.id IN (${ph})`, ids
  );
  const pointRows = await all(
    `SELECT rider_id, category, points FROM rider_points WHERE stage_nr = ? AND rider_id IN (${ph})`, [nr, ...ids]
  );
  const riderById = new Map(riderRows.map((r) => [r.id, r]));
  const ptsByRider = new Map();
  for (const p of pointRows) {
    const cur = ptsByRider.get(p.rider_id) || {};
    cur[p.category] = p.points;
    ptsByRider.set(p.rider_id, cur);
  }

  const breakdown = lineup.map((l) => {
    const rider = riderById.get(l.rider_id);
    const pts = ptsByRider.get(l.rider_id) || {};
    const stagePts = (pts.stage || 0) * (l.is_captain ? CAPTAIN_FACTOR : 1);
    return {
      riderId: l.rider_id, name: rider?.name ?? '?', team: rider?.team_name ?? '',
      nationality: rider?.nationality ?? '', type: rider?.type ?? '', teamShirt: rider?.team_shirt ?? null,
      isCaptain: !!l.is_captain,
      stagePoints: stagePts, classPoints: pts.class || 0, teamPoints: pts.team || 0,
      total: stagePts + (pts.class || 0) + (pts.team || 0),
    };
  }).sort((a, b) => b.total - a.total);

  return { stageNr: nr, breakdown, total: breakdown.reduce((s, b) => s + b.total, 0) };
}

// Puntenoverzicht van één etappe voor één deelnemer: twee lijsten met dezelfde
// kolommen — "lineup" (de 9 opgestelde renners, met behaalde punten) en "bench"
// (de niet-opgestelde renners uit het team van 20, met de punten die ze zouden
// hebben opgeleverd). Elke renner krijgt zijn finishpositie mee (eigen positie,
// of de ploegpositie bij een TTT). "gemist" is de som van de bank.
async function stageDaguitslag(userId, nr, stage) {
  const lineupRows = await all('SELECT rider_id, is_captain FROM lineups WHERE user_id = ? AND stage_nr = ?', [userId, nr]);
  const captainOf = new Map(lineupRows.map((r) => [r.rider_id, !!r.is_captain]));
  const teamIds = (await all('SELECT rider_id FROM user_teams WHERE user_id = ?', [userId])).map((r) => r.rider_id);
  const lineupIds = lineupRows.map((r) => r.rider_id);
  const benchIds = teamIds.filter((id) => !captainOf.has(id));

  // Finishpositie per renner: eigen positie (rit/ITT) of ploegpositie (TTT).
  const positionOf = new Map();
  if (stage.type === 'TTT') {
    const teamPos = new Map((await all('SELECT position, team_id FROM ttt_results WHERE stage_nr = ?', [nr])).map((r) => [r.team_id, r.position]));
    const inList = teamIds.length ? teamIds : [0];
    const riderTeam = new Map((await all(`SELECT id, team_id FROM riders WHERE id IN (${inList.map(() => '?').join(',')})`, inList)).map((r) => [r.id, r.team_id]));
    for (const id of teamIds) positionOf.set(id, teamPos.get(riderTeam.get(id)) ?? null);
  } else {
    const pm = new Map((await all('SELECT position, rider_id FROM stage_results WHERE stage_nr = ?', [nr])).map((r) => [r.rider_id, r.position]));
    for (const id of teamIds) positionOf.set(id, pm.get(id) ?? null);
  }

  // Bouwt de puntenrijen voor een set renners uit rider_points. Kopman telt
  // alleen bij de opstelling (×2 op de rituitslag); een bankzitter kan geen
  // kopman zijn, dus daar altijd de kale "zou hebben gekregen"-punten.
  const buildRows = async (ids, withCaptain) => {
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    const riderRows = await all(
      `SELECT r.id, r.name, r.nationality, r.type, t.name AS team_name, t.shirt_url AS team_shirt
       FROM riders r JOIN cycling_teams t ON t.id = r.team_id WHERE r.id IN (${ph})`, ids
    );
    const pointRows = await all(`SELECT rider_id, category, points FROM rider_points WHERE stage_nr = ? AND rider_id IN (${ph})`, [nr, ...ids]);
    const riderById = new Map(riderRows.map((r) => [r.id, r]));
    const ptsByRider = new Map();
    for (const p of pointRows) { const c = ptsByRider.get(p.rider_id) || {}; c[p.category] = p.points; ptsByRider.set(p.rider_id, c); }
    return ids.map((id) => {
      const r = riderById.get(id); const pts = ptsByRider.get(id) || {};
      const isCaptain = withCaptain && captainOf.get(id) === true;
      const stagePoints = (pts.stage || 0) * (isCaptain ? CAPTAIN_FACTOR : 1);
      return {
        riderId: id, name: r?.name ?? '?', nationality: r?.nationality ?? '', type: r?.type ?? '',
        team: r?.team_name ?? '', teamShirt: r?.team_shirt ?? null,
        position: positionOf.get(id) ?? null, isCaptain,
        stagePoints, classPoints: pts.class || 0, teamPoints: pts.team || 0,
        total: stagePoints + (pts.class || 0) + (pts.team || 0),
      };
    }).sort((a, b) => b.total - a.total);
  };

  const lineup = await buildRows(lineupIds, true);
  const bench = await buildRows(benchIds, false); // gesorteerd op totaal, aflopend
  const behaald = lineup.reduce((s, r) => s + r.total, 0);
  const rawStage = (r) => (r.isCaptain ? r.stagePoints / CAPTAIN_FACTOR : r.stagePoints);
  const rawTotal = (r) => rawStage(r) + r.classPoints + r.teamPoints;

  // Misgelopen = de nettowinst als je je slechtst scorende opgestelde renners had
  // geruild voor je best scorende bankzitters — maar alleen ruilen die punten
  // opleveren. Beste bankzitter tegen slechtste opsteller; stop zodra ruilen niet
  // meer loont (bankzitter <= opsteller). De ingewisselde bankzitters: swapIn=true.
  // Vergelijking gebeurt op RUWE totalen: de kopmanverdubbeling van de huidige
  // kopman mag een ruil die op ruwe punten wél loont niet blokkeren — anders
  // "beschermt" die verdubbeling een middelmatige kopman en onderschatten we
  // het werkelijk haalbare (zie test/points.test.js voor het rekenvoorbeeld).
  const worstLineup = lineup.map(rawTotal).sort((a, b) => a - b);
  let gemist = 0, gemistCount = 0;
  for (let i = 0; i < Math.min(lineup.length, bench.length); i++) {
    const gain = bench[i].total - worstLineup[i];
    if (gain <= 0) break;
    gemist += gain;
    gemistCount++;
  }
  bench.forEach((b, i) => { b.swapIn = i < gemistCount; });

  // Misgelopen door kopmankeuze = het verschil tussen de ritpunten van de
  // best scorende renner in je hele team (opstelling én bank) en die van je
  // daadwerkelijke kopman — los van de bankzitter-ruil hierboven, dus geen
  // dubbeltelling. Ook een renner die niet opgesteld stond kan hier de
  // "betere kopman" zijn geweest.
  const actualCaptain = lineup.find((r) => r.isCaptain);
  const bestRawStage = Math.max(0, ...lineup.map(rawStage), ...bench.map(rawStage));
  const gemistKopman = actualCaptain ? Math.max(0, bestRawStage - rawStage(actualCaptain)) : 0;

  return { stageNr: nr, type: stage.type, behaald, gemist, gemistCount, gemistKopman, lineup, bench };
}

app.get('/api/my/points/:nr', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  res.json(await pointsBreakdown(user.id, Number(req.params.nr)));
}));

// --- deelnemers (voor het klassement: teams en scores van anderen inzien) ----

// Opstellingen van open etappes blijven geheim (niet afkijken vóór de start);
// het team van 20 ligt na de Tourstart toch vast en is dus zichtbaar.
app.get('/api/participants/:userId', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const target = await get('SELECT id, name FROM users WHERE id = ?', [Number(req.params.userId)]);
  if (!target) return res.status(404).json({ error: 'Deelnemer niet gevonden' });

  const team = await all(`
    SELECT r.id, r.name, r.nationality, r.price, r.type, t.name AS team_name, t.shirt_url AS team_shirt
    FROM user_teams ut JOIN riders r ON r.id = ut.rider_id JOIN cycling_teams t ON t.id = r.team_id
    WHERE ut.user_id = ? ORDER BY r.price DESC, r.name
  `, [target.id]);
  const scores = await all('SELECT stage_nr, points FROM user_scores WHERE user_id = ? ORDER BY stage_nr', [target.id]);

  res.json({
    userId: target.id,
    name: target.name,
    team,
    scores: scores.map((s) => ({ stageNr: s.stage_nr, points: s.points })),
    total: scores.reduce((s, x) => s + x.points, 0),
  });
}));

app.get('/api/participants/:userId/points/:nr', ah(async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const nr = Number(req.params.nr);
  const userId = Number(req.params.userId);
  // Eindklassement (nr 0) heeft geen daguitslag — daar tonen we de uitsplitsing.
  if (nr === 0) {
    return res.json({ stageNr: 0, final: true, breakdown: (await pointsBreakdown(userId, 0)).breakdown });
  }
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [nr]);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });
  if (stage.status === 'open') return res.status(403).json({ error: 'Deze etappe is nog niet gestart' });
  res.json(await stageDaguitslag(userId, nr, stage));
}));

// --- admin ------------------------------------------------------------------

app.get('/api/admin/overview', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const stages = [];
  const stageRows = await all(`
    SELECT s.*, y.checked_at AS sync_checked_at, y.error AS sync_error
    FROM stages s LEFT JOIN stage_sync y ON y.stage_nr = s.nr
    ORDER BY s.nr
  `);
  for (const s of stageRows) {
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
  bustCache();
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

  // Handmatig opgeslagen uitslagen worden door de PCS-autosync met rust gelaten.
  await saveStageResult(nr, req.body || {}, 'manual');
  await run('UPDATE stage_sync SET error = NULL WHERE stage_nr = ?', [nr]);
  res.json({ ok: true });
}));

// Zet de uitslagbron van een etappe terug naar 'auto' (of expliciet op 'manual'),
// zodat de PCS-autosync hem weer oppakt of juist met rust laat.
app.put('/api/admin/stage/:nr/source', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const { source } = req.body || {};
  if (!['auto', 'manual'].includes(source)) return res.status(400).json({ error: 'Ongeldige bron' });
  await run('UPDATE stages SET result_source = ? WHERE nr = ?', [source, Number(req.params.nr)]);
  bustCache();
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

// Opstelling van een deelnemer zetten voor een (ook gesloten) etappe — handig
// als iemand te laat is. Validatie tegen het eigen team van 20 blijft staan.
// Draai daarna /api/admin/stage/:nr/process om de score te herberekenen.
app.put('/api/admin/lineup/:userId/:nr', ah(async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const target = await get('SELECT id, name FROM users WHERE id = ?', [Number(req.params.userId)]);
  if (!target) return res.status(404).json({ error: 'Deelnemer niet gevonden' });
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [Number(req.params.nr)]);
  if (!stage) return res.status(404).json({ error: 'Etappe niet gevonden' });

  const riderIds = [...new Set(req.body?.riderIds || [])];
  const captainId = req.body?.captainId;
  if (riderIds.length !== LINEUP_SIZE) return res.status(400).json({ error: `Stel precies ${LINEUP_SIZE} renners op` });
  if (!captainId || !riderIds.includes(captainId)) return res.status(400).json({ error: 'Wijs een kopman aan (één van de 9 opgestelde renners)' });

  const teamIds = new Set((await all('SELECT rider_id FROM user_teams WHERE user_id = ?', [target.id])).map((r) => r.rider_id));
  if (teamIds.size !== TEAM_SIZE) return res.status(400).json({ error: `${target.name} heeft nog geen compleet team van ${TEAM_SIZE} renners` });
  if (riderIds.some((id) => !teamIds.has(id))) return res.status(400).json({ error: 'Alleen renners uit het eigen team van deze deelnemer kunnen worden opgesteld' });

  await tx(async (h) => {
    await h.run('DELETE FROM lineups WHERE user_id = ? AND stage_nr = ?', [target.id, stage.nr]);
    for (const id of riderIds) {
      await h.run('INSERT INTO lineups (user_id, stage_nr, rider_id, is_captain) VALUES (?, ?, ?, ?)', [target.id, stage.nr, id, id === captainId ? 1 : 0]);
    }
  });
  res.json({ ok: true });
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
  bustCache();
  res.json({ ok: true });
}));

app.get('/api/admin/teams', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  res.json({ teams: await all('SELECT * FROM cycling_teams ORDER BY name') });
}));

app.get('/api/admin/users', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const users = await all(`
    SELECT u.id, u.name, u.email, u.is_admin, (u.google_id IS NOT NULL) AS has_google,
           u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM user_teams t WHERE t.user_id = u.id) AS team_count
    FROM users u ORDER BY u.created_at DESC
  `);
  const logins = await all(`
    SELECT e.at, e.method, u.name, u.email
    FROM login_events e JOIN users u ON u.id = e.user_id
    ORDER BY e.at DESC LIMIT 100
  `);
  res.json({ total: users.length, users, logins });
}));

// --- cron -------------------------------------------------------------------
// Aangeroepen door GitHub Actions (elke 10 min). PCS zit achter Cloudflare,
// dus de Action haalt de pagina's op met een echte browser en levert de HTML
// hier af. Flow: GET pcs-pending (wie heeft een uitslag nodig + auto-start)
// → per etappe POST pcs-html met { stageNr, html } of { stageNr, error }.

function cronAuthorized(req, res) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || '').replace('Bearer ', '') || req.query.key;
  if (!secret || given !== secret) { res.status(401).json({ error: 'Ongeldige sleutel' }); return false; }
  return true;
}

app.get('/api/cron/pcs-pending', ah(async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  const result = await syncTick();
  if (result.report.length) console.log('PCS-sync:', result.report.join(' | '));
  await checkLineupReminders().catch((e) => console.error('herinneringen:', e.message));
  res.json(result);
}));

app.post('/api/cron/pcs-html', ah(async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  const { stageNr, html, error } = req.body || {};
  if (!Number.isInteger(stageNr)) return res.status(400).json({ error: 'stageNr ontbreekt' });
  if (error) {
    await noteSyncError(stageNr, String(error).slice(0, 500));
    console.log(`PCS-sync: etappe ${stageNr}: fetch-fout uit Action — ${error}`);
    return res.json({ ok: true, noted: true });
  }
  if (typeof html !== 'string' || !html) return res.status(400).json({ error: 'html ontbreekt' });
  const report = await importStageHtml(stageNr, html);
  console.log('PCS-sync:', report);
  res.json({ ok: true, report });
}));

// Primaire uitslagenroute: de Action levert per etappe de letour.fr-
// klassementsfragmenten aan (ite/itg/ipg/img/ijg/ete). PCS blijft als fallback.
app.post('/api/cron/letour-html', ah(async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  const { stageNr, fragments, error } = req.body || {};
  if (!Number.isInteger(stageNr)) return res.status(400).json({ error: 'stageNr ontbreekt' });
  if (error) {
    await noteSyncError(stageNr, String(error).slice(0, 500));
    console.log(`letour-sync: etappe ${stageNr}: fetch-fout uit Action — ${error}`);
    return res.json({ ok: true, noted: true });
  }
  if (!fragments || typeof fragments !== 'object') return res.status(400).json({ error: 'fragments ontbreekt' });
  const report = await importLetourRankings(stageNr, fragments);
  console.log('letour-sync:', report);
  res.json({ ok: true, report });
}));

// Volledige data-export: alle scores, teams en opstellingen van alle deelnemers.
// Wachtwoord-hashes blijven bewust buiten de export.
async function fullExport() {
  const dump = { at: new Date().toISOString() };
  dump.users = await all('SELECT id, name, email, is_admin, created_at, last_login_at FROM users');
  for (const t of [
    'cycling_teams', 'riders', 'stages', 'user_teams', 'lineups', 'pools', 'pool_members',
    'stage_results', 'ttt_results', 'classification_standings', 'final_standings',
    'rider_points', 'user_scores', 'login_events', 'lineup_reminders',
  ]) {
    dump[t] = await all(`SELECT * FROM ${t}`);
  }
  return dump;
}

// Voor back-ups (GitHub Action bewaart dit elke 6 uur als artifact).
app.get('/api/cron/backup', ah(async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  res.json(await fullExport());
}));

// Zelfde export, maar als download voor de beheerder (knop in het adminpaneel).
app.get('/api/admin/export', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  res.setHeader('Content-Disposition', `attachment; filename="snorito-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(await fullExport());
}));

// Fallback: server-side fetch (werkt alleen als PCS de server niet blokkeert).
app.post('/api/cron/pcs-sync', ah(async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  const result = await runSync();
  console.log('PCS-sync:', result.report.length ? result.report.join(' | ') : 'geen acties');
  res.json(result);
}));

// --- productie: geserveerde frontend ----------------------------------------
// In productie serveert deze ene Node-service ook de gebouwde React-app
// (client/dist), zodat alles op één poort/URL draait. In dev gebruik je Vite (:5173).
const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  // Vite-assets hebben een hash in de bestandsnaam en mogen dus eeuwig gecachet
  // worden; index.html juist niet (die wijst naar de nieuwste assets).
  app.use(express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/(?:sw\.js|workbox-[^/]+\.js|manifest\.webmanifest)$/.test(filePath)) {
        // Service worker + manifest nooit hard cachen, anders blijft een oude
        // versie hangen en komt een nieuwe deploy niet door.
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA-fallback: alle niet-/api routes naar index.html (client-side routing)
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// --- achtergrondtaken ---------------------------------------------------------
// Eigen sync-interval naast de GitHub Action: de Action (elke 10 min, vaak met
// vertraging) blijft de wekker die Render wakker houdt, maar zolang de server
// draait halen we uitslagen elke 2 minuten zelf bij letour.fr — zo staan punten
// kort na de finish in de app in plaats van na een half uur. runSync is een
// no-op wanneer geen enkele etappe een uitslag nodig heeft.
let syncBusy = false;
setInterval(async () => {
  if (syncBusy) return;
  syncBusy = true;
  try {
    // Alleen lopende etappes in de snelle loop; rechecks van afgeronde etappes
    // doet de 10-minuten-Action (zie runSync-commentaar) — scheelt CPU-pieken.
    const result = await runSync({ fastOnly: true });
    const acted = result.report.filter((r) => !r.includes('nog niet compleet') && !r.includes('ongewijzigd'));
    if (acted.length) {
      console.log('interval-sync:', acted.join(' | '));
      bustCache();
    }
    await checkLineupReminders();
  } catch (e) {
    console.error('interval-sync:', e.message);
  } finally {
    syncBusy = false;
  }
}, 2 * 60_000);

// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Snorito draait op http://localhost:${PORT}`));
