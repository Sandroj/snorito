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
   keepalive-action. Structurele versnelling = Render Starter.
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
