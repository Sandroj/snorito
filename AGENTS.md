<!-- ════════════════ AI-START — lees dit eerst, elke sessie ════════════════ -->
<!-- Dit blok is tool-neutraal. Claude, Codex en Antigravity lezen dit bestand
     bij het opstarten (via AGENTS.md, of via de symlinks CLAUDE.md / GEMINI.md).
     Bewerk de flow-regels hieronder alleen bewust — ze houden het project
     doorontwikkelbaar over meerdere AI's en sessies heen. -->

# Doorontwikkel-flow (elke AI, elke sessie)

Dit project gebruikt een tool-neutrale flow zodat elke AI — of het nu Claude,
Codex of Antigravity is — naadloos verder kan waar de vorige stopte. **Git is de
waarheid; `HANDOFF.md` is het kompas.**

## Zodra je op dit project wordt gericht

1. Oriënteer op de echte stand: `git status` en `git log --oneline -12`.
2. Lees **`HANDOFF.md`** — daar staat waar de vorige sessie stopte en wat de
   volgende stap is. Lees ook de rest van dit bestand (project-instructies).
3. Pak "Volgende stap" uit `HANDOFF.md` op, of doe wat de gebruiker vraagt.
   Twijfel je wat de bedoeling is? Vraag het — verzin geen richting.

## Terwijl je werkt

- Commit klein en vaak, met duidelijke berichten in de gebiedende wijs
  ("Fix sync-bug in importer", niet "wijzigingen").
- Verwijder of overschrijf geen bestanden zonder overleg met de gebruiker.
- Eén AI tegelijk in deze repo. Werk je parallel, gebruik dan een aparte
  git-branch of worktree.

## Voordat je stopt (of de gebruiker weggaat)

1. **Commit al je werk** — laat de repo schoon achter (`git status` clean).
   Werk dat niet af is: commit als WIP met een duidelijk bericht.
2. **Werk `HANDOFF.md` bij**: wat je deed, wat af/getest is, de volgende stap,
   en elke valkuil die je tegenkwam. Schrijf het voor een AI die dit gesprek
   niet gezien heeft.
3. Meld de gebruiker in één zin waar het project nu staat.

<!-- ════════════════ EINDE AI-START — hieronder project-specifiek ════════════════ -->

Projectomschrijving – Wielerpoule App (Scorito-geïnspireerd)

Doel

Ontwikkel een webapplicatie waarmee gebruikers wielerpoules kunnen organiseren rondom de Tour de France. De functionaliteit en gebruikerservaring moeten grotendeels overeenkomen met de bestaande Scorito Tour de France-poule, maar de applicatie wordt volledig zelfstandig ontwikkeld.

Kernconcept

Gebruikers stellen voorafgaand aan de Tour de France een team samen van 9 renners. Elke renner heeft een vooraf bepaalde fictieve marktwaarde. Iedere gebruiker ontvangt een vast budget en moet binnen dit budget zijn of haar team samenstellen.

Tijdens de Tour verdienen renners punten op basis van hun prestaties. De punten van alle geselecteerde renners vormen samen de score van de gebruiker. Gebruikers kunnen zich onderling meten in één of meerdere privé- of openbare poules.

Basisfunctionaliteiten

Selecteren van een team

	•	Overzicht van alle deelnemende renners.
	•	Iedere renner heeft:
	•	Naam
	•	Team
	•	Nationaliteit
	•	Marktwaarde
	•	Eventuele aanvullende statistieken
	•	Team bestaat uit precies 9 renners.
	•	Totaalwaarde mag het beschikbare budget niet overschrijden.
	•	Validatie tijdens het samenstellen van het team.

Puntensysteem

Renners verdienen punten op basis van:

	•	Daguitslag van iedere etappe.
	•	Resultaten in:
	•	Algemeen klassement.
	•	Bergklassement.
	•	Puntenklassement (groene trui).
	•	Jongerenklassement (witte trui).
	•	Eventuele overige bonuspunten volgens vooraf ingestelde spelregels.

Alle punten worden automatisch verwerkt na afloop van iedere etappe.

Klassementen

De applicatie houdt automatisch bij:

	•	Dagklassement.
	•	Totaalklassement van iedere gebruiker.
	•	Ranglijst binnen iedere poule.
	•	Ranglijst van alle deelnemers.

Poules

Gebruikers kunnen:

	•	Een nieuwe poule aanmaken.
	•	Andere gebruikers uitnodigen.
	•	Deelnemen via een uitnodigingscode of link.
	•	Meerdere poules tegelijk spelen met hetzelfde team.

Gebruikers

	•	Registreren en inloggen.
	•	Eigen profiel.
	•	Historie van gespeelde poules.
	•	Overzicht van huidige scores.

Beheeromgeving (Admin)

Een beheerder moet eenvoudig kunnen:

	•	De Tour configureren.
	•	Teams toevoegen.
	•	Renners toevoegen en wijzigen.
	•	Marktwaardes instellen.
	•	Etappes beheren.
	•	Punten invoeren of automatisch importeren.
	•	Klassementen bijwerken.
	•	Spelregels aanpassen.

Datamodel (globaal)

Belangrijkste entiteiten:

	•	User
	•	Pool
	•	PoolMember
	•	Rider
	•	Team
	•	Stage
	•	StageResult
	•	Classification
	•	RiderPoints
	•	UserTeam
	•	UserSelection

Ontwerpprincipes

	•	Zeer snelle en eenvoudige teamselectie.
	•	Mobiel-first ontwerp.
	•	Live score-updates.
	•	Duidelijke ranglijsten.
	•	Intuïtieve navigatie.
	•	Hoge prestaties, ook tijdens piekmomenten na afloop van etappes.

Toekomstige uitbreidingen

Het systeem moet modulair worden opgezet zodat later eenvoudig ondersteuning kan worden toegevoegd voor:

	•	Giro d’Italia.
	•	Vuelta a España.
	•	WK Wielrennen.
	•	Voorjaarsklassiekers.
	•	Eigen puntensystemen.
	•	Transfers tijdens een ronde.
	•	Captain- of jokerfunctionaliteit.
	•	Pushnotificaties.
	•	Live tussenstanden.
	•	Automatische import van officiële uitslagen via API.

Belangrijk uitgangspunt

Het doel is om een fantasy wielerspel te bouwen dat qua functionaliteit vergelijkbaar is met Scorito, maar met een eigen implementatie, een schaalbare architectuur en uitbreidbare opzet. Alle spelregels, puntentellingen en configuraties moeten flexibel zijn, zodat toekomstige wielerevenementen en aangepaste spelvarianten zonder grote softwarewijzigingen ondersteund kunnen worden.
---

## Werkafspraken uitslagen en punten (belangrijk — leren van 5 juli 2026)

De uitslagen-sync (GitHub Action "Uitslagen sync" → letour.fr → /api/cron/letour-html)
herimporteert elke etappe tot 48 uur na de start opnieuw. Alles wat je buiten die
flow om in de database "repareert" wordt daardoor weer overschreven. Dat is op
5 juli gebeurd: een puntencorrectie voor etappe 1 was direct in de database gezet
en werd door de eerstvolgende sync ongedaan gemaakt.

Daarom:

1. **Corrigeer uitslagen of punten nooit met directe SQL op de productiedatabase.**
2. Klopt een geïmporteerde uitslag niet? **Fix de importlogica** (server/src/letour.js
   / sync.js, incl. test) en laat de sync de etappe opnieuw importeren — dan blijft
   de correctie ook bij elke hercheck staan.
3. Alleen als de bron (letour.fr) zelf fout is: voer de uitslag in via het
   **adminformulier**. Dat zet result_source='manual' en de sync blijft er dan af.
4. De puntenregels staan in docs/scorito-spelregels.md — dat document is de
   functionele waarheid (let op de bijzondere regels voor de ploegentijdrit:
   groene/bolletjestrui krijgen na een TTT wél leiders- en teampunten, posities
   2-5 niets).
5. Spelregels of puntwaardes wijzigen? Altijd eerst dat document bijwerken, dan
   points.js, dan tests.

---

## Correctie op de projectomschrijving hierboven

De oorspronkelijke omschrijving ("team van 9 renners") is bewust losgelaten.
Het echte Scorito-model is leidend: **team van 20 renners, budget €45M, max 4
per ploeg, per etappe 9 opstellen + 1 kopman (kopman ×2 op de daguitslag)**.
De app heet **Snorito** (mapnaam is nog "scorita").

## Architectuur en deployment (stand 7 juli 2026)

- **Stack:** Node/Express (`server/`) + Neon Postgres (gemigreerd van SQLite),
  React 18 + Vite + TypeScript (`client/`). Eén service serveert API én
  gebouwde frontend.
- **Live:** https://snorito-2j6w.onrender.com op Render (free tier).
  **Deploy = commit + push naar main** — Render bouwt en rolt automatisch uit.
  Er is dus geen aparte staging: wat je pusht, staat minuten later live.
- **Regio (gemeten 21 juli 2026, belangrijk bij snelheidsklachten):**
  `render.yaml` bevat geen `region:`, dus de service draait in Render's
  default **Oregon (US West)**, terwijl de gebruikers in Nederland zitten.
  Cloudflare-edge zit wél in AMS (TLS 30 ms), maar élke request loopt door
  naar Oregon: **~175 ms vaste bodem**, ook voor `/healthz` dat niets doet.
  `/api/riders` (mét DB-query) kost precies evenveel als `/healthz` — de
  servercode en database zijn dus níet de bottleneck. Ga bij "de site is
  traag" dus niet eerst code optimaliseren: meet met
  `curl -w "%{time_starttransfer} %{time_appconnect}"` op `/healthz` en trek
  af. **De Neon-database staat al wél in Frankfurt** (host eindigt op
  `eu-central-1.aws.neon.tech`), dus elke query steekt nu de oceaan over:
  gemeten **~145 ms per query** bovenop de ~175 ms van de gebruiker. Een
  endpoint met vier opeenvolgende query's zit daardoor op driekwart seconde.
  Let op: publieke endpoints als `/api/riders` hebben servercache en raken de
  database niet — meet dus met een ongecachet endpoint zoals
  `/api/rider/1/results`, anders lijkt alles ten onrechte even snel.
  Verhuizen naar Frankfurt is de grootste winst; stappenplan staat in
  `docs/regio-migratie-frankfurt.md`. **Schrijf nieuwe endpoints met
  `Promise.all` in plaats van opeenvolgende `await`s** — zolang de app in
  Oregon staat kost elke extra query ~145 ms.
- **`DISABLE_SYNC=1`** zet de in-process uitslagensync uit (herinneringsmails
  blijven draaien). Nodig als er twee instanties tegen dezelfde database
  draaien, en bruikbaar als noodrem tijdens een koersdag.
- **Puntenmotor:** `server/src/points.js` (tabellen bovenaan). Teamregels:
  constants in `server/src/db.js`. Spelregelpagina leest live uit
  `GET /api/rules`, dus UI en berekening kunnen niet uiteenlopen.
- **Uitslagen-import:** GitHub Action `pcs-sync.yml` ("Uitslagen sync") haalt
  letour.fr op en post naar `/api/cron/letour-html` (`server/src/letour.js` +
  `sync.js`). Procyclingstats werkt níet vanaf GitHub-runners (Cloudflare).
- **Overige workflows:** `keepalive.yml` (tegen Render cold starts, samen met
  cron-job.org op `/healthz`) en `backup.yml` (backups van teams/opstellingen).
- **E-mail:** Brevo (opstellingsherinnering 3 uur voor etappestart,
  `server/src/reminders.js`; wachtwoord-reset via `mail.js`). Keys staan als
  env-vars in Render, net als `DATABASE_URL` en `CRON_SECRET`.

## Verifiëren van wijzigingen (belangrijk — live product)

Lokaal kan niet alles: de sandbox blokkeert de Neon-database en het klassement
zit achter login. Gebruik daarom deze keten:

1. Client: `npm run build` (tsc + vite) moet slagen.
2. Server: `node --check` op gewijzigde bestanden + servertests draaien.
3. Na push: de live bundel-hash pollen tot de nieuwe build online staat.
4. Visuele controle in de live app doet Max zelf (ingelogd).

`git push` toont in de sandbox een credential-waarschuwing maar slaagt gewoon —
controleer de ref-update-regel.

## Als er iets misgaat tijdens een etappe (runbook)

1. Kloppen punten of uitslag niet? Volg de werkafspraken hierboven: importlogica
   fixen of adminformulier, nooit directe SQL.
2. Site traag of plat? Render free tier valt in slaap; check `/healthz` en de
   keepalive-action. Structurele versnelling = Render Starter. **Let op de
   gevoelige plek: de in-process letour-sync** (elke 2 min, `index.js`
   `setInterval` → `runSync`). Op de 0,1-vCPU free tier is dit de enige plek die
   álle requests kan laten pieken (ook `/healthz`, dat verder nul werk doet):
   `fetchLetourFragments` doet een synchrone cheerio-parse per etappe. Diagnose:
   piekt `/healthz` naar seconden terwijl p50 laag blijft, dan is het
   proces-blokkade door de sync, niet de database. Twee remmen zitten er al in
   (7 juli): AJAX-URL's worden per etappe gecached (geen 789 KB-paginafetch meer
   per ronde, `letour.js`), en de 2-min-loop draait `fastOnly` — alleen
   'started' etappes; rechecks van afgeronde etappes gaan via de 10-min Action
   (`syncTick` geeft ze wél terug, dus de Action verandert niet). Zoek bij een
   nieuwe piek dus eerst hoeveel etappes tegelijk 'started'/in-recheck zijn.
3. Data kwijt of kapot? Eerst de backup-artifacts van `backup.yml` checken
   voordat je iets herstelt of herseedt. **Nooit herseeden op productie** —
   dat wist accounts en poules.
4. Sync draait niet? `gh run list` voor "Uitslagen sync", daarna handmatig
   triggeren met `gh workflow run`.

De Tour loopt t/m 26 juli 2026 — tot die tijd is dit een live product met echte
gebruikers. Wees terughoudend met refactors tijdens koersdagen.

## Monitoring (sinds 7 juli 2026)

Er draait een geplande taak **`snorito-ochtendcheck`** (Claude, Scheduled-sectie,
dagelijks 08:33): read-only check op `/healthz`, de laatste "Uitslagen sync"-run
en `/api/rules`, met pushrapport aan Max. Loopt t/m 26 juli; meldt daarna zelf
dat hij uit kan. Niet dupliceren met extra monitoring zonder overleg.

Audit 7 juli (2 subagents + handmatige verificatie): puntentabellen, teamregels
en `/api/rules` zijn onderling consistent en conform docs/scorito-spelregels.md.
Let op bij toekomstige audits: de TTT-regel "posities 2–5 punt/berg niets" zit
níet in points.js maar in de importlaag (`filterJerseyPlaceholders`,
letour.js:42 + sync.js:216, met test) — een audit die alleen points.js leest
meldt hier ten onrechte een afwijking. Nog open: de regel "eindklassement pas
na ≥11 etappes" (spelregels) wordt niet in code afgedwongen.
