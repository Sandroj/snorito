# Postgres, gebruikersinzicht, wachtwoord-reset en PCS-autosync — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snorito's data overleeft deploys (Neon Postgres), admin ziet gebruikers en logins, wachtwoord-reset via Resend, en etappe-uitslagen komen volautomatisch van ProCyclingStats met volledige handmatige override.

**Architecture:** Opslaglaag van synchroon better-sqlite3 naar async `pg` met dunne helpers (`get`/`all`/`run`/`tx`) die de bestaande `?`-placeholders automatisch naar `$n` vertalen — de SQL blijft vrijwel ongewijzigd. Daarbovenop drie features als losse modules: `mail.js` (Resend via fetch), `pcs.js` (cheerio-parser + naammatching), `sync.js` (orkestratie, aangeroepen door een geheim cron-endpoint dat elke 10 min door GitHub Actions wordt geraakt).

**Tech Stack:** Node 22 (ESM), Express 4, `pg` (Neon), `cheerio`, Resend REST-API, React 18 + Vite (client), `node --test` voor parser-tests.

**Spec:** `docs/superpowers/specs/2026-07-04-postgres-reset-pcs-design.md`

**Testaanpak:** TDD met fixtures voor de PCS-parser (het riskantste onderdeel). Voor de storage-migratie en routes: verificatie door draaien (server boot, seed, curl-smoketests, client-flows via preview) — het project heeft geen bestaande testinfra en de migratie is mechanisch.

**Blokkades die Max moet oplossen (kunnen parallel):**
- `DATABASE_URL` (Neon) uit Render → in `server/.env` zetten zodat lokaal getest kan worden.
- Resend API-key → `RESEND_API_KEY` in Render (instructies al gegeven).
- `CRON_SECRET` in Render Environment (waarde genereren we in Taak 8; GitHub-secrets zet ik zelf via `gh`).

---

## Bestandsstructuur

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `server/src/db.js` | herschrijven | pg-pool, schema, query-helpers, tx, constants |
| `server/src/index.js` | ombouwen | alle routes async; nieuwe routes: forgot/reset, admin/users, cron, stage/source |
| `server/src/points.js` | ombouwen | processStage/processFinal async binnen `tx` |
| `server/src/seed.js` | ombouwen | seed async; nieuwe tabellen in wipe-lijst |
| `server/src/demo.js` | ombouwen | idem |
| `server/src/mail.js` | nieuw | Resend-mail + fallback naar log |
| `server/src/ratelimit.js` | nieuw | in-memory rate limiting |
| `server/src/pcs.js` | nieuw | PCS ophalen + parsen + naammatching (pure functies waar mogelijk) |
| `server/src/sync.js` | nieuw | auto-start, import, 48u-hercheck, stage_sync-log |
| `server/test/pcs.test.js` | nieuw | parser- en matchingtests met fixtures |
| `server/test/fixtures/*.html` | nieuw | echte PCS-pagina's |
| `.github/workflows/pcs-sync.yml` | nieuw | cron-ping elke 10 min |
| `client/src/pages/Login.tsx` | wijzigen | "Wachtwoord vergeten?"-flow |
| `client/src/pages/Reset.tsx` | nieuw | nieuw wachtwoord instellen |
| `client/src/pages/Admin.tsx` | wijzigen | gebruikersblok; per etappe bron/sync-status/knop |
| `client/src/App.tsx` | wijzigen | route `/reset` |
| `server/package.json` | wijzigen | `pg` + `cheerio` erin, `better-sqlite3` eruit; `--env-file-if-exists`; testscript |

---

### Taak 1: Postgres-basislaag (`db.js`)

**Files:** Modify: `server/src/db.js`, `server/package.json`

- [ ] **Stap 1: dependencies**

```bash
cd server && npm uninstall better-sqlite3 && npm install pg cheerio
```

- [ ] **Stap 2: scripts in `server/package.json`** (env-file voor lokaal; Render levert env zelf)

```json
"scripts": {
  "dev": "node --env-file-if-exists=.env src/index.js",
  "seed": "node --env-file-if-exists=.env src/seed.js",
  "demo": "node --env-file-if-exists=.env src/demo.js",
  "test": "node --test test/"
}
```

- [ ] **Stap 3: `db.js` volledig vervangen.** Kern (volledige schema-DDL is de bestaande DDL met deze vertaalregels):

```js
import pg from 'pg';

// COUNT/SUM komen uit pg als string (bigint/numeric) — als number teruggeven.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL ontbreekt — zet hem in server/.env (lokaal) of Render (productie).');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: 5,
});

// De bestaande SQL gebruikt '?'-placeholders; vertaal naar $1, $2, …
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
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

export async function initSchema() { await pool.query(SCHEMA_SQL); }
```

Vertaalregels DDL (verse database, dus alles direct in het schema — geen `ensureColumn`-migraties meer):
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY` (users, cycling_teams, pools). `riders.id` blijft gewoon `INTEGER PRIMARY KEY` (expliciete Scorito-id's).
- `TEXT ... DEFAULT (datetime('now'))` → `TIMESTAMPTZ NOT NULL DEFAULT now()`.
- `google_id`/`avatar_url`/unieke index gaan rechtstreeks het schema in.
- Nieuw in schema: `users.last_login_at TIMESTAMPTZ`; `stages.result_source TEXT` (null/'auto'/'manual'); tabellen:

```sql
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stage_sync (
  stage_nr INTEGER PRIMARY KEY REFERENCES stages(nr),
  checked_at TIMESTAMPTZ,
  error TEXT
);
```

- Constants (`BUDGET` t/m `CAPTAIN_FACTOR`) en `riderStarted` ongewijzigd overnemen.

- [ ] **Stap 4: commit**

```bash
git add server/ && git commit -m "Postgres-basislaag: pg-pool, helpers, schema"
```

---

### Taak 2: Async-conversie van alle bestaande code

**Files:** Modify: `server/src/index.js`, `server/src/points.js`, `server/src/seed.js`, `server/src/demo.js`

Mechanische regels, overal toepassen:

| better-sqlite3 | wordt |
|---|---|
| `db.prepare(sql).get(a, b)` | `await get(sql, [a, b])` |
| `db.prepare(sql).all(a)` | `await all(sql, [a])` |
| `db.prepare(sql).run(a)` | `await run(sql, [a])` |
| `.run(...).lastInsertRowid` | `... RETURNING id` + `(await get(...)).id` — of `(await run(sql + ' RETURNING id', p)).rows[0].id` |
| `const tx = db.transaction(() => {...}); tx();` | `await tx(async (h) => {...})` met binnenin `h.get/h.all/h.run` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `ON CONFLICT ... SET points = points + excluded.points` | `SET points = rider_points.points + EXCLUDED.points` |
| prepared statement hergebruikt in lus (`ins.run(...)`) | gewone `await h.run(sql, [...])` per iteratie |

- [ ] **Stap 1: `index.js`.** Bovenaan een async-wrapper en die om élke handler:

```js
const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'Serverfout' });
});
// gebruik: app.get('/api/riders', ah(async (_req, res) => { ... }));
```

Verder: `currentUser`, `requireUser`, `requireAdmin`, `startSession`, `teamLocked` worden async (aanroepen: `const user = await requireAdmin(req, res)`); `ensureSeeded()` → `await ensureSeeded()` (top-level await, vóór `app.listen`); `app.listen` pas na init. Google-callback: de twee user-queries en insert/update volgens de regels hierboven.

- [ ] **Stap 2: `points.js`.** `processStage`/`processFinal` worden `async function`; de hele body zit al in één `db.transaction` → wordt één `await tx(async (h) => {...})`. Let op de EXCLUDED-regel hierboven (2×).

- [ ] **Stap 3: `seed.js` en `demo.js`.** `runSeed`/`ensureSeeded` async; wipe-lijst uitbreiden met `password_resets` (vóór `users`) en `stage_sync` (vóór `stages`); `initSchema()` aanroepen vóór de wipe; team-insert en createUser via `RETURNING id`. CLI-entry (`process.argv[1] === …`) krijgt `await`.

- [ ] **Stap 4: draai en smoke-test** (vereist `server/.env` met DATABASE_URL)

```bash
cd server && npm run seed
npm run dev &
curl -s localhost:3001/api/stages | head -c 300      # 21 etappes
curl -s -X POST localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"max@demo.nl","password":"demo123"}'   # user-object terug
npm run demo                                          # verwerkt etappe 1+2
curl -s localhost:3001/api/stages | python3 -c "import json,sys; print([s['status'] for s in json.load(sys.stdin)['stages']][:3])"
```

Verwacht: seed voltooid, login werkt, na demo staan etappe 1+2 op `finished`. Daarna via preview de client-flows checken (login, team, ranking, admin-uitslag herverwerken).

- [ ] **Stap 5: commit**

```bash
git add server/ && git commit -m "Migreer opslaglaag naar Postgres (Neon): alle queries en transacties async"
```

---

### Taak 3: Deploy A + live verificatie

- [ ] **Stap 1:** `git push` → Render bouwt en start; log volgen op fouten.
- [ ] **Stap 2:** Live: registreren, inloggen, team samenstellen; **Google-login testen** (stond nog open).
- [ ] **Stap 3:** In Render "Manual Deploy" doen (of wachten op volgende push) en verifiëren dat accounts **blijven bestaan** — het hele doel van deze migratie.

---

### Taak 4 (B): Login-tracking + admin-gebruikersoverzicht

**Files:** Modify: `server/src/index.js`, `client/src/pages/Admin.tsx`, `client/src/api.ts`

- [ ] **Stap 1:** In login-route én Google-callback, na geslaagde authenticatie:

```js
await run('UPDATE users SET last_login_at = now() WHERE id = ?', [user.id]);
```

- [ ] **Stap 2:** Nieuw endpoint:

```js
app.get('/api/admin/users', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const users = await all(`
    SELECT u.id, u.name, u.email, u.is_admin, (u.google_id IS NOT NULL) AS has_google,
           u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM user_teams t WHERE t.user_id = u.id) AS team_count
    FROM users u ORDER BY u.created_at DESC`);
  res.json({ total: users.length, users });
}));
```

- [ ] **Stap 3:** Admin.tsx: nieuw blok "Gebruikers" (stijl van bestaande blokken volgen): totaalteller + tabel met naam, e-mail, Google-badge, registratie, laatste login (`toLocaleString('nl-NL')`), team x/20.
- [ ] **Stap 4:** Verifiëren via preview (inloggen als admin, blok zichtbaar, last_login vult na een login). Commit: `git commit -m "Admin-gebruikersoverzicht + last_login-tracking"`.

---

### Taak 5 (C): Wachtwoord-reset via Resend + rate-limiting

**Files:** Create: `server/src/mail.js`, `server/src/ratelimit.js`, `client/src/pages/Reset.tsx`. Modify: `server/src/index.js`, `client/src/pages/Login.tsx`, `client/src/App.tsx`

- [ ] **Stap 1: `ratelimit.js`**

```js
const buckets = new Map();
// true = toegestaan; sliding window in-memory (reset bij herstart — prima hier)
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { buckets.set(key, recent); return false; }
  recent.push(now); buckets.set(key, recent);
  return true;
}
```

- [ ] **Stap 2: `mail.js`** — Resend REST (geen SDK). Zonder `RESEND_API_KEY` alleen loggen. NB: de reset-link wordt óók mét key gelogd — bewuste keuze zolang resend.dev alleen naar Max' eigen adres mag mailen, zodat hij links kan doorgeven.

```js
export async function sendPasswordResetMail(to, link) {
  console.log(`Reset-link voor ${to}: ${link}`);
  if (!process.env.RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Snorito <onboarding@resend.dev>',
      to: [to],
      subject: 'Wachtwoord opnieuw instellen — Snorito',
      html: `<p>Klik op de link om een nieuw wachtwoord in te stellen (1 uur geldig):</p>
             <p><a href="${link}">${link}</a></p>
             <p>Niet zelf aangevraagd? Negeer deze mail.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
```

- [ ] **Stap 3: routes in `index.js`** (+ rate limit op bestaande login: `if (!rateLimit(\`login:${req.ip}\`, 20, 15 * 60_000)) return res.status(429).json({ error: 'Te veel pogingen — probeer het later opnieuw' });`)

```js
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

app.post('/api/auth/forgot', ah(async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const generic = { ok: true }; // altijd hetzelfde antwoord — geen e-mail-enumeratie
  if (!email) return res.json(generic);
  if (!rateLimit(`forgot-ip:${req.ip}`, 10, 15 * 60_000)) return res.json(generic);
  if (!rateLimit(`forgot:${email}`, 3, 15 * 60_000)) return res.json(generic);
  const user = await get('SELECT * FROM users WHERE lower(email) = ?', [email]);
  if (!user) return res.json(generic);
  const token = crypto.randomBytes(32).toString('hex');
  await run(`INSERT INTO password_resets (user_id, token_hash, expires_at)
             VALUES (?, ?, now() + interval '1 hour')`, [user.id, sha256(token)]);
  try { await sendPasswordResetMail(user.email, `${appUrl(req)}/reset?token=${token}`); }
  catch (e) { console.error('Mailfout:', e.message); }
  res.json(generic);
}));

app.post('/api/auth/reset', ah(async (req, res) => {
  const { token, password } = req.body || {};
  if (!rateLimit(`reset:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: 'Te veel pogingen — probeer het later opnieuw' });
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens zijn' });
  }
  const row = await get(`SELECT * FROM password_resets
                         WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()`, [sha256(token)]);
  if (!row) return res.status(400).json({ error: 'Deze link is ongeldig of verlopen — vraag een nieuwe aan' });
  const salt = crypto.randomBytes(16).toString('hex');
  await tx(async (h) => {
    await h.run('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?', [hashPassword(password, salt), salt, row.user_id]);
    await h.run('UPDATE password_resets SET used_at = now() WHERE id = ?', [row.id]);
    await h.run('DELETE FROM sessions WHERE user_id = ?', [row.user_id]); // oude sessies eruit
  });
  res.json({ ok: true });
}));
```

- [ ] **Stap 4: client.** Login.tsx: link "Wachtwoord vergeten?" die het formulier omschakelt naar één e-mailveld → POST `/api/auth/forgot` → altijd melding "Als dit adres bekend is, is er een e-mail verstuurd." Nieuw `Reset.tsx` (token uit `location.search`, twee wachtwoordvelden, POST `/api/auth/reset`, bij succes link naar inloggen). Route `/reset` in App.tsx — let op: moet ook zonder ingelogde sessie bereikbaar zijn, net als `/login`.
- [ ] **Stap 5: verifiëren** lokaal zonder key: forgot → link uit serverlog → reset → oude sessie ongeldig, nieuw wachtwoord werkt, token tweede keer gebruiken faalt, verlopen token faalt (expires_at handmatig terugzetten in DB). Commit: `git commit -m "Wachtwoord-reset via Resend + rate-limiting op auth-routes"`.

---

### Taak 6 (D1): PCS-parser, fixture-gedreven

**Files:** Create: `server/src/pcs.js`, `server/test/pcs.test.js`, `server/test/fixtures/`

- [ ] **Stap 1: fixtures ophalen** (via WebFetch of curl; sandbox-netwerk staat PCS mogelijk niet toe vanuit Bash — dan WebFetch gebruiken en opslaan): de uitslagpagina van een afgeronde Tour-etappe (bv. `race/tour-de-france/2025/stage-1`) plus de `-gc`, `-points`, `-kom`, `-youth`-varianten, en een TTT-uitslag (bv. `race/paris-nice/2025/stage-3` of de 2026-ploegentijdrit zodra gereden). Opslaan als `server/test/fixtures/stage.html`, `gc.html`, enz.
- [ ] **Stap 2: tests eerst** — verwachte waarden handmatig uit de fixture-HTML aflezen:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseResultTable, normalizeName, matchByName } from '../src/pcs.js';

test('daguitslag: top-20 met posities en namen', () => {
  const rows = parseResultTable(fs.readFileSync('test/fixtures/stage.html', 'utf8'), 'rider');
  assert.equal(rows[0].position, 1);
  assert.ok(rows.length >= 20);
  assert.match(rows[0].name, /\w/);           // exacte naam invullen vanuit fixture
});
test('DNF-rijen worden overgeslagen', () => { /* rij zonder numerieke positie → niet in output */ });
test('TTT: ploegen i.p.v. renners', () => {
  const rows = parseResultTable(fs.readFileSync('test/fixtures/ttt.html', 'utf8'), 'team');
  assert.ok(rows.length >= 8);
});
test('normalizeName: accenten, hoofdletters, woordvolgorde', () => {
  assert.equal(normalizeName('POGAČAR Tadej'), normalizeName('Tadej Pogačar'));
});
test('matchByName: alle fixture-namen matchen tegen rennerslijst; onbekende naam → in unmatched', () => { /* … */ });
```

- [ ] **Stap 3:** `npm test` → FAIL (module bestaat nog niet).
- [ ] **Stap 4: implementeer `pcs.js`:**

```js
import * as cheerio from 'cheerio';

export const PCS_BASE = 'https://www.procyclingstats.com';
export const RACE_PATH = 'race/tour-de-france/2026';
const CLS_SUFFIX = { alg: 'gc', punt: 'points', berg: 'kom', jong: 'youth' };

export const normalizeName = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]+/g, ' ')
  .trim().split(/\s+/).sort().join(' ');

// kind: 'rider' | 'team' — eerste resultatentabel; rijen met niet-numerieke positie (DNF/DNS) overslaan
export function parseResultTable(html, kind) { /* cheerio: table.results tbody tr; eerste td = positie; naam uit a[href^="rider/"] of a[href^="team/"] — selectors op de fixtures afstemmen */ }

export function matchByName(names, entities) {
  const byNorm = new Map(entities.map((e) => [normalizeName(e.name), e]));
  const matched = new Map(); const unmatched = [];
  for (const n of names) {
    const hit = byNorm.get(normalizeName(n));
    if (hit) matched.set(n, hit); else unmatched.push(n);
  }
  return { matched, unmatched };
}

export async function fetchStagePages(stageNr) {
  const urls = {
    stage: `${PCS_BASE}/${RACE_PATH}/stage-${stageNr}`,
    ...Object.fromEntries(Object.entries(CLS_SUFFIX).map(([cls, suf]) =>
      [cls, `${PCS_BASE}/${RACE_PATH}/stage-${stageNr}-${suf}`])),
  };
  const out = {};
  for (const [key, url] of Object.entries(urls)) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Snorito poule)' } });
    if (!res.ok) throw new Error(`PCS ${res.status} op ${url}`);
    out[key] = await res.text();
  }
  return out;
}
```

- [ ] **Stap 5:** `npm test` → PASS. Commit: `git commit -m "PCS-parser met fixtures en naammatching"`.

---

### Taak 7 (D2): sync-orkestratie + cron-endpoint + bron-vlag

**Files:** Create: `server/src/sync.js`. Modify: `server/src/index.js`

- [ ] **Stap 1: uitslag-opslag herbruikbaar maken.** De transactie-body van `PUT /api/admin/stage/:nr/result` verhuist naar een gedeelde functie in `sync.js` (of apart bestandje), met bron-parameter:

```js
export async function saveStageResult(nr, { positions = [], tttPositions = [], classifications = {} }, source) {
  const stage = await get('SELECT * FROM stages WHERE nr = ?', [nr]);
  if (!stage) throw new Error(`Etappe ${nr} bestaat niet`);
  await tx(async (h) => {
    /* bestaande delete+insert-logica uit de admin-route, met h.run */
    await h.run('UPDATE stages SET result_source = ? WHERE nr = ?', [source, nr]);
  });
}
```

De admin-route roept dit aan met `source: 'manual'` en wist daarna de sync-fout (`UPDATE stage_sync SET error = NULL WHERE stage_nr = ?`).

- [ ] **Stap 2: `runSync()` in `sync.js`:**

```js
const CEST = '+02:00'; // hele Tour 2026 valt in de zomertijd
const startMs = (stage) => new Date(`${stage.start}${CEST}`).getTime();
const H48 = 48 * 3600_000;

export async function runSync() {
  const report = [];
  const stages = await all('SELECT * FROM stages ORDER BY nr');
  const riders = await all('SELECT * FROM riders');
  const teams = await all('SELECT * FROM cycling_teams');
  const now = Date.now();

  for (const s of stages) {
    if (s.status === 'open' && now >= startMs(s)) {
      await run("UPDATE stages SET status = 'started' WHERE nr = ?", [s.nr]);
      s.status = 'started';
      report.push(`etappe ${s.nr}: gestart`);
    }
    const wantsImport =
      (s.status === 'started') ||
      (s.status === 'finished' && s.result_source === 'auto' && now - startMs(s) < H48);
    if (!wantsImport) continue;

    try {
      const payload = await importFromPcs(s, riders, teams); // fetch + parse + match + compleetheids-check
      if (!payload) { await note(s.nr, null); continue; }    // uitslag nog niet compleet op PCS
      if (s.status === 'finished' && !(await differsFromStored(s, payload))) { await note(s.nr, null); continue; }
      await saveStageResult(s.nr, payload, 'auto');
      await processStage(s.nr); // idempotent; zet status op finished
      await note(s.nr, null);
      report.push(`etappe ${s.nr}: uitslag verwerkt`);
    } catch (e) {
      await note(s.nr, e.message); // fout zichtbaar in adminpaneel; etappe onaangeroerd
      report.push(`etappe ${s.nr}: FOUT ${e.message}`);
    }
  }
  return { report };
}
```

Details: `importFromPcs` levert `null` zolang niet compleet (regulier: ≥20 rennersrijen; TTT: ≥8 ploegrijen; elk klassement ≥5); niet-gematchte namen → `throw` met de namen in de melding. `note(nr, err)` = upsert in `stage_sync` (checked_at = now(), error). `differsFromStored` vergelijkt posities/rider-ids met de huidige tabellen.

- [ ] **Stap 3: routes in `index.js`:**

```js
app.post('/api/cron/pcs-sync', ah(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || '').replace('Bearer ', '') || req.query.key;
  if (!secret || given !== secret) return res.status(401).json({ error: 'Ongeldige sleutel' });
  res.json(await runSync());
}));

app.put('/api/admin/stage/:nr/source', ah(async (req, res) => {
  const user = await requireAdmin(req, res); if (!user) return;
  const { source } = req.body || {};
  if (!['auto', 'manual'].includes(source)) return res.status(400).json({ error: 'Ongeldige bron' });
  await run('UPDATE stages SET result_source = ? WHERE nr = ?', [source, Number(req.params.nr)]);
  res.json({ ok: true });
}));
```

En `GET /api/admin/overview` uitbreiden: per etappe `result_source`, `sync_error`, `sync_checked_at` (LEFT JOIN `stage_sync`).

- [ ] **Stap 4: verifiëren.** Lokaal: `curl -X POST 'localhost:3001/api/cron/pcs-sync?key=test'` met `CRON_SECRET=test` in `.env`. Verwacht vandaag (etappe 1 bezig/net klaar): etappe 1 → `started`, en zodra PCS de TTT-uitslag heeft → verwerkt + `finished`. Handmatige override testen: uitslag aanpassen in admin → bron wordt `manual` → volgende sync raakt hem niet aan → knop terug naar `auto` → sync pakt hem weer. Commit: `git commit -m "PCS-autosync: cron-endpoint, auto-start, 48u-hercheck, handmatige override"`.

---

### Taak 8 (D3): Admin-UI + GitHub Actions

**Files:** Create: `.github/workflows/pcs-sync.yml`. Modify: `client/src/pages/Admin.tsx`

- [ ] **Stap 1: Admin.tsx per etappe:** badge bron ("automatisch" / "handmatig" / "—"), laatste sync-check + eventuele foutmelding in rood, en bij bron=manual een knop "Auto-sync weer aanzetten" → `PUT /api/admin/stage/:nr/source {source:'auto'}`.
- [ ] **Stap 2: workflow:**

```yaml
name: PCS sync
on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping sync-endpoint
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/cron/pcs-sync"
```

- [ ] **Stap 3: secrets zetten** (CRON_SECRET genereren met `openssl rand -hex 24`):

```bash
gh secret set CRON_SECRET --body "<gegenereerde waarde>"
gh secret set APP_URL --body "https://<render-url>"
```

Zelfde `CRON_SECRET`-waarde moet Max in Render → Environment zetten (instructie in eindbericht).

- [ ] **Stap 4:** commit + push; workflow handmatig triggeren (`gh workflow run "PCS sync"`), run-log checken (`gh run list/view`). Commit: `git commit -m "Admin-syncstatus + GitHub Actions cron voor PCS-sync"`.

---

### Taak 9: Eindverificatie + deploy

- [ ] Volledige lokale regressie: seed → registreren → team → opstelling → cron-sync etappe 1 → punten zichtbaar → admin-correctie → herverwerken.
- [ ] `client`: `npm run build` zonder fouten.
- [ ] Push, Render-deploy volgen, live: reset-flow (met Resend-key), admin-gebruikersblok, sync-status, workflow-runs groen.
- [ ] Verifieer nogmaals dat data een deploy overleeft.

---

## Zelfreview (uitgevoerd)

- Spec-dekking: A→Taak 1–3, B→Taak 4, C→Taak 5, D→Taak 6–8, testparagraaf→Taak 2/6/7/9. ✓
- Openstaande afhankelijkheden van Max expliciet bovenaan. ✓
- Typen consistent: helpers `get/all/run/tx` overal; `saveStageResult(nr, payload, source)` in Taak 7 stap 1 en 2 gelijk. ✓
- Bewuste afwijking van volledige TDD buiten de parser, gemotiveerd in de kop. ✓
