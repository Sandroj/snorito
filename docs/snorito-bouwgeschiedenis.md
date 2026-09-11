# Hoe we Snorito bouwden

*3 t/m 10 juli 2026*

---

## Voorwerk: concept en data (rond 3 juli)

Startpunt was de projectomschrijving: een wielerpoule-app naar het model van de Scorito Tour de France-poule, volledig zelf gebouwd. De oorspronkelijke opzet ("team van 9 renners") is bewust vervangen door het echte Scorito-model: **20 renners, €45M budget, max 4 per ploeg, per etappe 9 opstellen + 1 kopman (×2 op de daguitslag)**.

De data kwam rechtstreeks van Scorito's interne API, opgehaald via een ingelogde browsersessie met de Chrome-extensie: 206 renners met prijzen en kwaliteiten (0–10), 21 etappes met profielkaartjes, 23 ploegen met shirt-afbeeldingen. De volledige spelregels en puntentabellen zijn gescrapet naar `docs/scorito-spelregels.md` — sindsdien de functionele waarheid van het puntensysteem.

---

## 3 juli — dag 1: fundament en meteen live

- Eerste commit ("Snorito wielerpoule"): Node/Express-server met SQLite, React 18 + Vite + TypeScript client, mobiel-first met bottom-nav. Eén service serveert API én frontend.
- Dezelfde middag live op Render gezet (na wat build-fixes en het pinnen van Node 22). Vanaf dit moment gold: **deploy = push naar main**.
- 's Avonds de teamselectie-overhaul: filteren op de 7 kwaliteiten, kwaliteitsbolletjes, echte teamshirts, ploegen-grid, glass-design in geel/navy met het snor-logo.

---

## 4 juli — dag 2: de Tour start om 15:05

De drukste dag, want die middag begon de Tour met de ploegentijdrit in Barcelona.

- **Google-login** — server-side OAuth-flow zelf gebouwd; daarna gefixte SQLite-migratie en toegevoegde loginknop.
- **Postgres-migratie** (spec → plan → uitvoering in één ochtend): van better-sqlite3 naar async `pg` tegen Neon, zodat accounts en teams deploys overleven. De gratis Render-schijf wiste namelijk de database bij elke deploy.
- **Automatische uitslagen-import**: eerst via procyclingstats (parser fixture-getest, cron-endpoint, 48-uurs hercheckvenster, bron-vlag auto/manual). Cloudflare blokkeerde de GitHub-runners → 's avonds omgezet naar **letour.fr als bron** (officieel, geen blokkade).
- Wachtwoord-reset via Brevo, rate-limiting, login-logboek.
- Datacorrecties: etappe-starttijden stonden in UTC (alle 21 naar CEST), rennersbestand teruggebracht naar de officiële startlijst (206 → 184).
- Late inschrijving mogelijk gemaakt en **backups elke 6 uur** als GitHub-artifact.

---

## 5 juli — de leerdag

Twee incidenten die de werkafspraken hebben gevormd:

- Een puntencorrectie voor etappe 1 werd direct in de database gezet — en door de eerstvolgende sync stilletjes overschreven. Sindsdien de harde regel: **nooit directe SQL op productie**; fix de importlogica of gebruik het adminformulier.
- Eerder waren ook al eens alle poules gewist door een data-herimport. Les: imports moeten accounts en gebruikersdata altijd ongemoeid laten, en er is nooit meer geherseed op productie.

---

## 6 juli — polish, snelheid en de live-ervaring

- TTT-truiregel gefixt (groene/bolletjestrui krijgen na een ploegentijdrit wél leiders- en teampunten).
- "Sneller, socialer, attenter": gzip, servercache, clientcache; klassement werd klikbaar per deelnemer (team + scores + uitsplitsing); opstellingsherinnering per mail 3 uur voor de etappestart.
- In-process sync elke 2 minuten — punten staan nu minuten na de finish live.
- Keep-alive tegen Render cold starts (`/healthz` + 5-minuten-Action).
- Klassement-detail als A/B-experiment: optie A (daguitslag top-20 met markering) vs. optie B (opstelling + bank met gemiste punten). **Optie B won** en staat live; beide bewaard als git-tags.
- Opstelling-pagina: trui-badges per renner, resultaten per etappe uitklapbaar, opslaan-feedback, klaar-vinkje in het klassement.
- "Punten"-tab werd "Uitslagen", laatste etappe standaard uitgeklapt; daguitslag responsive op mobiel.
- Performance-diagnose tegen live: code en database bleken af — de resterende traagheid is de Render free tier zelf.

---

## 7 juli — professionalisering

- **PWA**: installeerbaar op mobiel, schermvullend, eigen icoon.
- Security-ronde: rate limit op registratie, security-headers.
- Latency-rootcause gevonden: de in-process sync blokkeerde op de 0,1-vCPU alle requests → AJAX-URL-caching en `fastOnly`-sync als remmen.
- Nieuwe features: "misgelopen kopmanpunten" en het "Raak gekozen?"-percentage in het klassement, plus drie puntenbugfixes.
- Audit met twee subagents: puntentabellen, teamregels en `/api/rules` consistent met de spelregels.
- Documentatie-infrastructuur: architectuur, verificatieketen en runbook in de project-CLAUDE.md; dagelijkse **ochtendcheck** als geplande taak (08:33); de `handoff`-skill.

---

## 8 juli — overdraagbaarheid

- Tool-neutrale doorontwikkel-flow opgezet: `AGENTS.md` + `HANDOFF.md`, zodat elke AI om en om verder kan. Git is de waarheid, HANDOFF het kompas.
- Fixes uit de praktijk van etappe 5: de auto-sync mocht het klassement niet leegvegen bij een tijdelijk lege fetch; mobiele UI-fixes.

---

## 10 juli — grote iteratie + herstel

- **Vijftien taken via subagent-driven development**: uitgevallen renners niet meer selecteerbaar en gelabeld in het klassement, herbruikbare etappe-accordion, en een snelheidsronde (batch-queries in plaats van N+1, database-indexes, code-splitting met React.lazy, memoization, agressievere caching, request-timing-logs).
- Feedback legde drie problemen bloot, waaronder een **witte pagina** op het deelnemer-detail: een subagent had een React-hooks-fout geïntroduceerd die door drie reviews heen was geglipt. Herstel: hooks-fix, accordion herbouwd (dropdown met eerdere etappes bóven de altijd-uitgeklapte laatste etappe), en uitgevallen renners overal in de Opstelling-stijl (gedimd + chip "uitgevallen").
- Nieuwe verificatiemethode die dit soort fouten voortaan vangt: een lokale stub-API die de echte gebouwde app met nepdata serveert, zodat complete flows in de browser getest worden vóór elke push.

---

## Waar het nu staat

Live op **snorito-2j6w.onrender.com** met echte gebruikers in de poule "Tour de Test", volautomatische uitslagenverwerking vanaf letour.fr, dagelijkse monitoring, zesuurlijkse backups — en de Tour loopt nog t/m 26 juli.

> De rode draad: in twee dagen van niets naar een live product op de dag van de Tourstart, daarna al draaiende verbeterd — waarbij elke fout (overschreven correcties, gewiste poules, de hooks-crash) direct is omgezet in een vastgelegde werkafspraak.
