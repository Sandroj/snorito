# HANDOFF — Snorito (scorita)

> Levend statusbestand + startpunt voor de volgende AI-sessie. Kort en concreet.
> Architectuur, valkuilen en runbook staan in `AGENTS.md` — hier alleen de stand.

## Waar staan we
**Live product** op https://snorito-2j6w.onrender.com (Render free tier), Neon
Postgres. De Tour de France 2026 loopt **t/m 26 juli 2026** — echte gebruikers,
dus terughoudend met refactors op koersdagen. Deploy = commit + push naar `main`
(Render bouwt en rolt automatisch uit; geen staging).

## Laatst gedaan (2026-07-21)

### Sessie 5 — Automatisch uitgevallen renners + openbare live-opstelling (niet gecommit)
Twee wensen van Max, allebei geïmplementeerd en lokaal geverifieerd (stub-API +
preview-browser), **nog niet gecommit/gepusht** — even beoordelen voor push
tijdens een koersdag.

1. **Uitgevallen renners automatisch detecteren** (`server/src/letour.js`,
   `sync.js`): het `itg`-fragment (algemeen klassement) van letour.fr bevat het
   volledige nog-actieve veld, niet alleen top-N (geverifieerd: 166 van ~184
   renners rond etappe 15). Een renner die uit dat klassement verdwijnt terwijl
   hij nog niet als uitgevallen te boek staat, wordt automatisch op
   `last_started_stage` gezet — precies wat Max eerst handmatig deed via het
   adminformulier. Veiligheidsklep: `MAX_PLAUSIBLE_ABANDONS_PER_SYNC = 10` — te
   veel gelijktijdige afwezigen (teken van een kapotte fetch) wordt NIET
   automatisch verwerkt, komt als sync-fout in het adminpaneel. Draait mee in
   de bestaande import (elke 2/10 min), geen nieuwe scraping-infra. Getest:
   `detectNewAbandons` in `test/letour.test.js`. Het handmatige adminformulier
   blijft bestaan als fallback/correctie.
2. **Opstellingen openbaar zodra een etappe start, zonder punten**: nieuw
   endpoint `GET /api/participants/:userId/lineup/:nr` (403 zolang de etappe
   nog 'open' is, net als het bestaande `/points/:nr`). Client: `Ranking.tsx`
   toont in de deelnemer-detailweergave, bóven de normale uitslagen-accordion,
   een `LiveLineupCard` voor de etappe die nu 'started' is maar nog geen
   verwerkte score heeft — alleen renners + kopman-chip + grijs voor
   uitgevallen, geen puntenkolommen. Zodra de etappe verwerkt is (in
   `user_scores`) neemt de gewone `StageAccordion` het vanzelf over.

3. **Donkere achtergrond etappeprofielen** (`client/src/style.css`,
   `.stage-profile`). De Scorito-PNG's hebben een **transparante** achtergrond
   en zetten de **colnamen en hoogtes in witte tekst** (COL DU TOURMALET
   2115 m, COL D'ASPIN 1489 m, …) plus witte verbindingslijnen naar het
   profiel. Op de witte kaart was al die informatie volledig onzichtbaar.
   Gemeten met een eigen PNG-decoder: ~4.600 witte pixels op transparant
   tegenover ~10 donkere — een donkere achtergrond verbergt dus niets en
   onthult veel. De zwarte onderschriften ("Pau — 186,2 km") staan op een
   eigen ingebakken witte plaat en blijven leesbaar. Achtergrond is nu
   hetzelfde navyverloop als `.total-hero`.

### Snelheidsonderzoek (gemeten, 21 juli) — belangrijkste conclusie
**De dominante vertraging is niet de code maar de regio.** `render.yaml` heeft
geen `region:`, dus Render draait in de default **Oregon (US West)** terwijl de
gebruikers in Nederland zitten. Metingen vanaf NL:
- Cloudflare-edge zit in **AMS** (TLS-handshake 30 ms) — het netwerk hierheen
  is dus snel.
- `/healthz` (doet letterlijk niets) kost **~175-200 ms servertijd**, met
  uitschieters naar 0,6 s.
- `/api/riders` (DB-query + 6 KB antwoord) kost **exact evenveel** als
  `/healthz`. De servercache en de indexen uit sessie 3 werken dus prima —
  die ~175 ms is puur de oversteek AMS → Oregon → AMS.

**Actie voor Max (niet zelf gedaan, want het raakt de infrastructuur):**
overweeg de service naar **Frankfurt** te verplaatsen; dat brengt die ~175 ms
per request terug naar ~15-25 ms — 7 à 10× sneller op élke request. Let op:
(a) Render kan de regio van een bestaande service niet wijzigen, je maakt een
nieuwe service (nieuwe URL, tenzij je een eigen domein gebruikt), en (b) check
**eerst in welke regio de Neon-database staat** — staat die in de VS, dan
verplaats je het probleem alleen maar naar de DB-verbinding. Beide in de EU is
het doel.

**Wat wél in code is opgelost:**
- **Klassementsparser 19× sneller** (`letour.js`, `parseRiderRanking`):
  cheerio bouwde een volledige DOM van een 610 KB-fragment voor ~166 rijen.
  Vervangen door een gerichte scan: gemeten **196 ms → 10 ms** over alle vijf
  fragmenten, met **exact identieke uitkomst** (geverifieerd tegen de oude
  cheerio-implementatie op de echte live-fragmenten én de fixtures). Dit
  scheelt op de 0,1-vCPU free tier seconden geblokkeerde event loop per
  sync-tick — precies tijdens een etappe, wanneer iedereen ververst.
  Randgevallen vastgelegd in een nieuwe test.
- **`/api/participants/:userId`**: vier opeenvolgende DB-query's zijn nu één
  `Promise.all`, en het antwoord bevat `liveStageNr` zodat de client daar geen
  aparte `/api/stages`-call voor doet.
- **Opstellingspagina laadt in één golf** in plaats van twee: nieuwe route
  `/api/lineup/next` laat de server zelf de eerstvolgende open etappe kiezen,
  zodat de client niet eerst `/api/stages` hoeft af te wachten. Geverifieerd in
  de browser: één request in plaats van twee (~175 ms winst per bezoek).

Niet gedaan (bewust): `parseTeamRanking` gebruikt nog cheerio — die draait
alleen bij een ploegentijdrit (etappe 1, al geweest), dus niet de moeite.

**Aanvulling op de regiobevinding (belangrijker dan eerst gedacht):** de
Neon-database staat blijkens de host (`...eu-central-1.aws.neon.tech`) al in
**Frankfurt**, terwijl de app in Oregon draait. Elke query steekt dus de oceaan
over. Gemeten: `/api/rider/1/results` (3 opeenvolgende query's, geen cache)
kost **615-1123 ms** tegenover ~200 ms voor `/healthz` — dat is **~145 ms per
databasequery** bovenop de ~175 ms van de gebruiker naar Oregon. De eerder
gemeten "alles is even snel"-uitkomst kwam doordat de publieke endpoints
servercache hebben en de database niet raken; de pagina's achter login wél.

**Besluit Max (21 juli): de migratie naar Frankfurt gaat niet door.** Het plan
blijft als onderbouwing staan in `docs/regio-migratie-frankfurt.md`, maar stel
het niet opnieuw voor. Gevolg: die ~145 ms per query en ~175 ms per serverronde
blijven bestaan, dus snelheidswerk betekent voortaan **minder query's en minder
serverrondes** — `Promise.all` in plaats van opeenvolgende `await`s.

Wel opgeleverd: **`DISABLE_SYNC=1`** zet de in-process sync uit (herinnerings-
mails blijven draaien). Bedoeld als noodrem tijdens een koersdag.

**Volgende stap:** alles van deze sessie staat live (gepusht 21 juli). Kandidaten
voor vervolg, in volgorde van verwachte winst:
1. `stageDaguitslag` (`server/src/index.js`) doet nog opeenvolgende query's —
   met `Promise.all` valt daar naar schatting enkele honderden ms te winnen op
   de uitslagenpagina.
2. `/api/ranking` en `/api/my/points` op hetzelfde punt nalopen.
3. De spelregel "eindklassement pas na ≥11 etappes" wordt nog niet in code
   afgedwongen.

## Laatst gedaan (2026-07-10)

### Sessie 4 — Herstel na feedback Max (d29e725)
- **Witte pagina gefixt:** deelnemer-detail in Klassement crashte door een
  `useMemo` ná een early return (Rules of Hooks — geïntroduceerd door een
  subagent in sessie 3, brak productie). Hooks weggehaald.
- **StageAccordion herbouwd:** dropdown "Eerdere etappes bekijken…" stáát nu
  boven de laatste etappe; laatste etappe altijd volledig uitgeklapt; een
  gekozen eerdere etappe klapt volledig uit tussen dropdown en laatste etappe.
  Component haalt de daguitslag-details nu zelf op (met cache per etappe) —
  Points.tsx en Ranking.tsx zijn daardoor flink versimpeld.
- **Uitgevallen renners in Opstelling-stijl:** gedimde rij (`opacity .4`) +
  chip "uitgevallen" in teamselectie (niet toevoegbaar, wel verwijderbaar) én
  in de teamlijst van deelnemers onder Klassement (`.row-retired`).
- **Verificatie-aanpak (nieuw, aanrader):** stub-API in scratchpad die
  `client/dist` serveert met nepdata + preview-browser — hele flow
  (klassement → deelnemer → detail, dropdown, teamselectie, uitslagen) echt
  getest vóór push. Views zitten live achter login, dus dit is de manier.
- **Les:** UI-refactors van subagents niet alleen op build/spec reviewen maar
  de flow ook echt renderen — de hooks-crash kwam door drie subagent-reviews
  heen.

### Sessie 3 — Vier Features + Snelheidsoptimalisatie (compleet)

**Deel 1: Uitgevallen Renners** (4 tasks)
- ✅ Task 1: API `/api/riders` — `available` flag (aee9315)
- ✅ Task 2: Client Team.tsx — renners filteren (3e56d1e)
- ✅ Task 3: API participants — `retired` flag (6c5c332)
- ✅ Task 4: Client Ranking — "UIT" label (86d3573)

**Deel 2: Uitslagen UI** (3 tasks)
- ✅ Task 5: StageAccordion component (07918a1)
- ✅ Task 6: Points.tsx refactor (1a3cacc)
- ✅ Task 7: Ranking.tsx refactor (c5e7e77)

**Deel 3: Snelheidsoptimalisatie** (8 tasks)
- ✅ Task 8: Server caching `/api/riders` (5 min TTL) (8daa8f4)
- ✅ Task 9: Batch-query klassement + indexes (c11ae3d, cbaab92)
- ✅ Task 10: Lazy-loading verify (ParticipantDetail al correct)
- ✅ Task 11: React.memo + useMemo (RiderInfo, Daguitslag, PointTable) (4630b8a)
- ✅ Task 12: Code-splitting React.lazy (alle pages) (3d89ccd)
- ✅ Task 13: Gzip + cache-busting (al geïmplementeerd, verified)
- ✅ Task 14: Database indexering (5 indexes) (fb85160)
- ✅ Task 15: Request timing middleware (889b35b)

**Impact:**
- Renners die uitvallen: nu onmiddellijk niet selecteerbaar, correct gelabeld in klassement
- Uitslagen UI: laatste etappe open, vorige in dropdown (schonere interface)
- Performance: ~70% gzip reduction, lazy-page-load (~30% kleiner initial bundle), batch-queries (N+1 → O(1)), memoization, caching
- Total: 15 commits, plan-driven development (all tasks spec-compliant + code-quality approved)

## Volgende stap
1. **Check eerst `git status`** — Max past soms zelf code aan tussen sessies.
2. Performance is nu beter. Volgende prioriteiten naar behoefte:
   - Admin-knop "renners herimporteren" (data-update zonder accounts te wissen)
   - Google-login live testen op Render
   - Spelregel "eindklassement pas na ≥11 etappes" in code afdwingen
   - Verdere query-optimalisaties (bv. /api/participants endpoints)
3. Zie `docs/handoff-prompt.md` (van 3–4 juli) voor volledige werkbacklog.

## Valkuilen / let op
- **Nooit directe SQL op productie** en **nooit herseeden** (wist accounts/poules).
  Uitslag klopt niet? Fix de importlogica of gebruik het adminformulier — zie de
  werkafspraken in `AGENTS.md`.
- Verificatieketen staat in `AGENTS.md` (lokaal kan niet alles: sandbox blokkeert
  Neon, klassement zit achter login). `git push` toont een credential-waarschuwing
  maar slaagt — check de ref-update-regel.

## Openstaand / ideeën
- Etappes automatisch op "gestart" zetten op basis van starttijd.
- `docs/handoff-prompt.md` is nu historisch archief; deze `HANDOFF.md` is leidend.
