# Snorito — handoff-prompt (vervolg op sessie van 3–4 juli 2026)

Gebruik dit als startprompt voor een nieuwe conversatie.

---

## Project

**Snorito** is een fantasy-wielerpoule voor de Tour de France 2026, geïnspireerd op de Scorito Wielermanager, volledig zelf gebouwd. Code staat in `~/claude-code/projects/scorita` (mapnaam is nog "scorita"; de app heet Snorito, met geel snor-logo). De Tour start vandaag, 4 juli 2026, om 15:05 met een ploegentijdrit in Barcelona.

## Stack & architectuur

- `server/` — Node/Express + **better-sqlite3**. Eén service serveert de API én de gebouwde frontend (`client/dist`) met SPA-fallback. Auto-seed bij lege database (`ensureSeeded` in `server/src/index.js`). DB-pad via env `DB_PATH` (default `server/snorito.db`).
- `client/` — React 18 + Vite + TypeScript, mobiel-first met bottom-nav. Dev: Vite op :5173 met proxy naar API op :3001. Launch-configs in `.claude/launch.json` (`api` en `web`).
- `data/` — bron-JSON (bij seed ingeladen):
  - `scorito_tdf2026_riders.json` — 206 renners: naam, team (moet exact matchen met teams-json), nationaliteit (3-letter), leeftijd, marktwaarde, type (primaire rol) en `kwaliteiten` (0–10, oneven mag; 7 = 3,5 bolletje van 5).
  - `stages_tdf2026.json` — 21 etappes incl. profielkaartje-URL (Scorito CDN) en korte NL-beschrijving.
  - `teams_tdf2026.json` — 23 ploegen incl. shirt-afbeelding-URL.
- `docs/scorito-spelregels.md` — volledige gescrapete Scorito-spelregels, puntentabellen en FAQ (referentie).
- **Puntenmotor:** `server/src/points.js` (alle tabellen bovenaan). **Teamregels:** constants onderaan `server/src/db.js`. De spelregelpagina `/regels` leest live uit `GET /api/rules`, dus UI en berekening kunnen nooit uiteenlopen.

## Spelmodel (conform het echte Scorito)

Team van **20 renners**, budget **€45M**, **max 4 per ploeg**, budgetregel: altijd €500K per resterende plek overhouden. Per etappe **9 opstellen + 1 kopman** (kopman ×2 op de daguitslag). Punten: daguitslag top-20; klassementen top-5 (alg/punt/berg/jong) na elke etappe; teampunten voor ploeggenoten van ritwinnaar/truidragers (renner moet gestart zijn); aparte ploegentijdrit-tabel (top-8 ploegen, punten per renner, snelste renner bepaalt ploegtijd); eindklassement telt over alle 20 renners. Deadlines: team wijzigen tot start etappe 1; opstelling tot etappestart. Etappestatus (open/started/finished) beheert de admin; verwerken is idempotent (herverwerken = corrigeren). Uitvallers niet vervangbaar; punten blijven staan.

**Let op:** de project-CLAUDE.md beschrijft het oorspronkelijke idee met "9 renners per team" — bewust afgeweken; het echte Scorito-model (20/9/kopman) is leidend.

## Wat af en getest is

- Registratie/login: scrypt + unieke salt per gebruiker, HttpOnly-sessiecookie, `Secure` in productie, trust proxy.
- Teamselectie: filteren op de **7 kwaliteiten** (niet op rol — daardoor 90 "klimmers" i.p.v. 8); klik op renner = uitklap met **alle** kwaliteiten + leeftijd/land/prijs; +/−-knop selecteert onafhankelijk van uitklappen; wrappende filterchips; zoekveld.
- Kwaliteitsbolletjes met halve stappen (waarde/2 van 5, geverifieerd in DOM).
- **Ploegen-weergave**: grid met echte shirtjes van alle 23 teams; per ploeg renners selecteren; teller "x/4 gekozen".
- Opstelling per etappe: 9 + kopman, met etappekaart (profielkaartje + NL-beschrijving + deadline).
- Klassementen: algemeen + per poule, podium-weergave; poules aanmaken/joinen via code/verlaten; puntenpagina met breakdown per renner (rit/klassement/team, kopman ×2).
- Admin: etappestatus, uitslag invoeren (top-20 of TTT top-8 + 4 klassementstanden), opslaan & verwerken, uitvallers registreren, eindklassement invoeren/verwerken.
- Design: geel/navy met snor-logo, rustige achtergrond-blob-animatie, glass-effecten, responsive t/m 320px.
- **Google-login:** Max bouwde zelf de server-side OAuth-flow (`/api/auth/google` + callback in `server/src/index.js`, kolommen `google_id`/`avatar_url`). Daarna gefixt: SQLite kan geen UNIQUE-kolom toevoegen via ALTER TABLE → kolom + aparte unieke index (in `db.js`); en er is nu een "Doorgaan met Google"-knop op de loginpagina met foutafhandeling (`/login?error=google`). Lokaal getest (nette melding zonder credentials); **live nog niet getest**.

## Deployment

Live op **Render** (gratis tier) via Max' GitHub-repo; deploy = commit + push (Render draait `npm run build` + `npm start` uit de root-package.json, Node 22 gepind, `render.yaml` aanwezig). Gratis schijf is **tijdelijk**: database reset bij elke deploy en wordt dan automatisch opnieuw geseed. In Render staan al klaar als env-vars: `DATABASE_URL` (Neon Postgres), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Redirect-URI's staan in Google Console (`http://localhost:3001/api/auth/google/callback` + de Render-URL-variant).

## Accounts & demo (na seed)

- admin@snorito.app / admin123 (beheer) · max@demo.nl / demo123 (+ anna/piet/kees @demo.nl) · demo-poule code **DEMO01**
- `cd server && npm run seed` = schone pre-Tour-stand (alles open) · `npm run demo` = fictieve uitslagen etappe 1+2 om het puntensysteem te zien.

## Directe aandachtspunten

1. **Check eerst `git status`** — er kunnen niet-gecommitte lokale wijzigingen staan (uitklapbare renner-details; Google-login incl. fix en knop). Alles bouwde en was getest bij de handoff; push om live te zetten.
2. **Hoofdtaak: Postgres-migratie.** Opslaglaag herschrijven van synchroon better-sqlite3 naar async `pg` tegen Neon (`DATABASE_URL` staat al in Render), zodat accounts/teams deploys overleven. Denk aan: schema-aanmaak, seed alleen bij lege DB, alle queries én transacties async, en lokaal blijven werken (fallback naar SQLite zonder `DATABASE_URL` is een optie).
3. **Daarna:** admin-knop "renners herimporteren" (data-updates zonder accounts te wissen — Max gaat de rennersdata in `data/scorito_tdf2026_riders.json` handmatig corrigeren, want ploegindelingen/kwaliteiten wijken deels af van Scorito).
4. **Google-login live testen** op Render zodra gepusht.
5. Klein: rate-limiting op login. Optioneel handig nu de Tour loopt: etappes automatisch op "gestart" zetten op basis van starttijd.

## Werkafspraken

Nederlands. Geen bestanden verwijderen zonder toestemming. Plan tonen bij complexe taken. Max vibecodet en past soms zelf code aan — check bij twijfel eerst of de server boot en de client bouwt, en repareer chirurgisch in plaats van terug te draaien (zijn Google-flow was bijvoorbeeld prima). Scorito-data is destijds via de browser-extensie met Max' ingelogde sessie opgehaald; endpoints staan in het memory-bestand `scorito-api-toegang`.
