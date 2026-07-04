# Ontwerp: Postgres-migratie, gebruikersinzicht, wachtwoord-reset en automatische PCS-import

Datum: 4 juli 2026 · Status: goedgekeurd door Max

## Context

Snorito draait live op Render (gratis tier) met better-sqlite3. De schijf is tijdelijk: elke deploy wist de database. De Tour de France 2026 start vandaag. Vier werkstromen, in deze volgorde:

1. **A — Postgres-migratie** (fundament: data moet deploys overleven)
2. **B — Gebruikersinzicht en login-tracking**
3. **C — Wachtwoord-reset via Resend**
4. **D — Volautomatische etappe-uitslagen uit ProCyclingStats**

## A. Postgres-migratie

Opslaglaag van synchroon better-sqlite3 naar asynchroon `pg` tegen Neon Postgres (`DATABASE_URL` staat al klaar in Render).

- `server/src/db.js`: connection-pool op `DATABASE_URL`, schema-aanmaak met Postgres-types (`SERIAL`/`GENERATED ALWAYS AS IDENTITY`, `TIMESTAMPTZ DEFAULT now()`, `BOOLEAN`), queryhulpen (`query`, `get`, `all`, `run`) async. Placeholders `$1, $2, …`.
- Alle aanroepen in `index.js`, `points.js`, `seed.js`, `demo.js` async maken; Express-handlers worden `async` met nette foutafhandeling.
- Transacties via `BEGIN`/`COMMIT`/`ROLLBACK` op een dedicated client uit de pool (o.a. `processStage`, uitslag opslaan, teamopslag).
- Seed alleen bij lege database (zelfde `ensureSeeded`-gedrag).
- Lokaal ontwikkelen: ook tegen Neon, via een aparte dev-branch/database in `server/.env`. Geen dubbel SQLite/Postgres-codepad.
- `better-sqlite3` als dependency vervangen door `pg`.
- Bekende consequentie: de deploy van deze migratie wist de huidige (toch al tijdelijke) SQLite-data één laatste keer.

## B. Gebruikersinzicht en login-tracking

- Kolom `users.last_login_at TIMESTAMPTZ`, bijgewerkt bij e-mail-login én Google-login.
- Adminpaneel: blok met totaal aantal gebruikers en tabel per gebruiker: naam, e-mail, registratiedatum, laatste login, team ingeleverd ja/nee.
- Endpoint: `GET /api/admin/users` (admin-only).

## C. Wachtwoord-reset (Resend)

- Loginpagina: link "Wachtwoord vergeten?" → formulier met e-mailadres.
- `POST /api/auth/forgot`: genereert token (32 bytes random), slaat **hash** op in nieuwe tabel `password_resets (id, user_id, token_hash, expires_at, used_at, created_at)`, mailt via Resend een link `APP_URL/reset?token=…`. Geldigheid 1 uur, eenmalig bruikbaar. Respons is altijd identiek, ook bij onbekend e-mailadres (geen enumeratie).
- `POST /api/auth/reset`: valideert token, stelt nieuw wachtwoord in (scrypt + nieuwe salt), markeert token gebruikt, maakt bestaande sessies van de gebruiker ongeldig. Werkt ook voor Google-accounts: daarna werken beide loginmethoden.
- Resetpagina in de client (`/reset`).
- Env: `RESEND_API_KEY`, `APP_URL`. Zonder API-key wordt de reset-link in de serverlog geschreven in plaats van gemaild (lokaal handig).
- Rate-limiting (eenvoudig, in-memory per IP+e-mail): op `/api/auth/login`, `/api/auth/forgot` en `/api/auth/reset`.
- Van Max nodig: gratis Resend-account, API-key in Render. Zonder eigen domein verstuurt Resend vanaf een onboarding-adres.

## D. Volautomatische PCS-import

### Trigger

- Geheim endpoint `POST /api/cron/pcs-sync` (header of query met `CRON_SECRET`).
- GitHub Actions-workflow in de bestaande repo (schedule elke 10 min) roept het endpoint aan. Dit maakt de slapende Render-instance ook wakker. GitHub-cron kan enkele minuten vertragen; acceptabel.

### Sync-logica (per aanroep)

1. Etappes waarvan de starttijd is verstreken en die nog `open` zijn → status `started`.
2. Voor etappes met status `started`: PCS pollen. Pas als de uitslag **compleet** is (daguitslag top-20, of ploegen-top-8 bij de TTT, plus vier klassementen algemeen/punten/berg/jongeren) wordt hij opgeslagen, verwerkt (`processStage`, idempotent) en de etappe `finished`.
3. Etappes die `finished` zijn, korter dan 48 uur geleden gestart en **niet** handmatig aangepast: opnieuw bij PCS controleren; bij een gewijzigde uitslag opnieuw opslaan en verwerken.
4. Niets half verwerken: bij parse-fouten of niet-gematchte namen wordt de etappe niet aangeraakt en wordt de fout zichtbaar in het adminpaneel.

### PCS-bron en parsing

- URL's: `https://www.procyclingstats.com/race/tour-de-france/2026/stage-{nr}` plus klassementsvarianten (gc/points/kom/youth). Race-slug en jaar als constanten in één module `server/src/pcs.js`.
- Parsing met `cheerio`. Naammatching: normalisatie (accenten, hoofdletters, PCS-formaat "ACHTERNAAM Voornaam") tegen de rennerstabel; TTT-ploegnamen idem tegen `cycling_teams`. Niet-gematchte namen → sync-fout voor die etappe.

### Handmatige controle blijft volledig

- Bestaand admin-formulier blijft: uitslag bekijken, aanpassen, herverwerken — ook ná verwerking.
- Nieuwe kolom `stages.result_source` (`auto` / `manual`, null = nog geen uitslag). Handmatig opslaan zet `manual`; de auto-sync slaat `manual`-etappes over. Adminpaneel toont de bron per etappe met een knop "auto-sync weer aanzetten" (zet terug naar `auto`).
- Sync-status zichtbaar in adminpaneel: laatste sync-tijdstip en eventuele fout per etappe (nieuwe tabel of config-entries `sync_log`).

## Foutafhandeling

- PCS onbereikbaar of gewijzigde opmaak: sync logt de fout, etappe blijft onaangeroerd, handmatig invoeren blijft altijd mogelijk.
- Resend-fout: gebruiker krijgt generieke melding, fout in serverlog.
- Cron-endpoint zonder geldige secret: 401.

## Testen

- Postgres: lokaal tegen Neon-dev — server boot, seed, registreren/inloggen, team kiezen, opstelling, uitslag invoeren, verwerken, klassementen; `npm run demo`-flow.
- PCS-parser: tegen de echte etappe-1-pagina zodra de uitslag er staat (Tour start vandaag 15:05); naammatching gevalideerd over alle 206 renners.
- Reset-flow lokaal zonder API-key (link uit serverlog), daarna live met Resend.
- Na deploy: Google-login live testen (stond nog open uit de handoff).

## Buiten scope

- Admin-knop "renners herimporteren" (aparte taak uit de handoff).
- E-mailverificatie bij registratie.
- Transfers, pushnotificaties, overige handoff-wensen.
