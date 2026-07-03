# Snorito — Wielerpoule (Tour de France 2026)

Fantasy-wielerspel geïnspireerd op de Scorito Wielermanager, met eigen implementatie en eigen gezicht.
Status: proof of concept — functioneel compleet voor één ronde.

## Spelmodel (conform Scorito, zie docs/scorito-spelregels.md)

- Team van **20 renners**, budget **€ 45.000.000**, max **4 renners per ploeg**
- Slimme budgetregel: je moet altijd genoeg overhouden om de resterende plekken te vullen (min. € 500.000 p.p.)
- Per etappe **9 renners opstellen + 1 kopman** (kopman scoort dubbele punten op de etappe-uitslag)
- Punten per etappe: top 20 daguitslag, top 5 per klassement (alg/punt/berg/jong), teampunten (ploeggenoot wint rit of draagt een trui)
- Ploegentijdrit: aparte puntentabel (top 8 ploegen, punten per renner)
- Eindklassement: punten over alle 20 renners (top 20 alg, top 10 punt/berg, top 5 jong + teampunten)
- Deadlines: team wijzigen kan tot de start van etappe 1; opstelling per etappe tot de starttijd
- Poules: aanmaken, meedoen via code, eigen ranglijst per poule
- Uitvallers: kunnen niet vervangen worden; behouden punten; scoren daarna niet meer

## Waar staan de spelregels?

| Wat | Waar |
|---|---|
| Puntentabellen en puntenmotor | `server/src/points.js` — alle tabellen staan bovenaan het bestand |
| Teamregels (budget, 20 renners, max 4/ploeg, kopman-factor) | `server/src/db.js` (constants onderaan) |
| In-app spelregelpagina | `/regels` in de app — leest de tabellen **live** uit de motor via `GET /api/rules` |
| Originele Scorito-regels (referentie, gescrapet) | `docs/scorito-spelregels.md` |

De spelregelpagina kan dus nooit afwijken van wat er daadwerkelijk wordt berekend.

## Architectuur

```
server/   Express + better-sqlite3 (API, puntenmotor, sessies)
client/   React + Vite + TypeScript (mobiel-first SPA)
data/     Gescrapete Scorito-data: 206 renners, 21 etappes met profielkaartjes en beschrijvingen
docs/     Spelregels, puntentabellen en FAQ (referentie)
```

- Etappes tonen het officiële profielkaartje (CDN Scorito-sports) plus een korte Nederlandse beschrijving per rit.
- Verwerken is idempotent: een etappe opnieuw verwerken overschrijft de oude punten (correcties mogelijk).

## Starten

```bash
cd server && npm install && npm run seed && npm run dev   # API op :3001
cd client && npm install && npm run dev                    # Web op :5173
```

Of via Claude Preview: launch-configuraties `api` en `web`.

## Demo-accounts (na `npm run seed`)

| Account | Wachtwoord | Rol |
|---|---|---|
| admin@snorito.app | admin123 | Beheerder (uitslagen invoeren/verwerken) |
| max@demo.nl | demo123 | Deelnemer |
| anna@demo.nl / piet@demo.nl / kees@demo.nl | demo123 | Deelnemers |

- Demo-poule met code **DEMO01**
- Na `npm run seed` staat alles open: het team is aan te passen tot etappe 1 start (realistische pre-Tour-stand)
- `npm run demo` (in server/) laadt fictieve uitslagen voor etappe 1+2 en verwerkt ze — handig om het puntensysteem en de klassementen te zien. Terug naar schoon: `npm run seed`

## Beheerflow (admin)

1. Zet een etappe op *gestart* zodra hij begint (opstellingen en — bij etappe 1 — de teamselectie locken automatisch)
2. Voer na afloop de daguitslag (top 20, of top 8 ploegen bij TTT) en de vier klassementstanden in
3. Klik *Opslaan & verwerken* — alle scores en ranglijsten worden direct herberekend
4. Uitvallers: zoek de renner en registreer zijn laatst gestarte etappe
5. Na de slotrit: eindklassementen invoeren en verwerken

## Nog niet in de PoC (bewust)

- Automatische uitslag-import (admin voert handmatig in)
- E-mailnotificaties, wachtwoord-reset
- Meerdere evenementen tegelijk (voorbereid: puntentabellen/spelregels zijn per bestand geconfigureerd, niet hardcoded in de flow)
