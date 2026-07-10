# HANDOFF — Snorito (scorita)

> Levend statusbestand + startpunt voor de volgende AI-sessie. Kort en concreet.
> Architectuur, valkuilen en runbook staan in `AGENTS.md` — hier alleen de stand.

## Waar staan we
**Live product** op https://snorito-2j6w.onrender.com (Render free tier), Neon
Postgres. De Tour de France 2026 loopt **t/m 26 juli 2026** — echte gebruikers,
dus terughoudend met refactors op koersdagen. Deploy = commit + push naar `main`
(Render bouwt en rolt automatisch uit; geen staging).

## Laatst gedaan (2026-07-10)
- **Task 2 — Retired riders:** Voorkomen dat gepensioneerde renners geselecteerd
  kunnen worden bij teamselectie. Geïmplementeerd:
  - Backend: `available` flag op riders API (gebaseerd op `last_started_stage`)
  - Frontend: canAdd() check, visuele "Niet beschikbaar" badge, dynamische disable-reason
  - Keuze bewaard: reeds geselecteerde niet-beschikbare renners kunnen verwijderd worden
  - Geverifieerd: spec compliant, TypeScript clean, commit klopt
  - Status: LIVE

## Volgende stap
1. **Check eerst `git status`** — Max past soms zelf code aan tussen sessies.
2. Werkbacklog: zie de originele `docs/handoff-prompt.md` (van 3–4 juli) voor de
   volledige lijst. **Let op: deels achterhaald** — de daar genoemde
   Postgres-migratie en rate-limiting op registratie zijn inmiddels gedaan.
   Nog relevant daaruit: admin-knop "renners herimporteren" (data-update zonder
   accounts te wissen), Google-login live testen, rate-limiting ook op login.
3. Uit `AGENTS.md` nog open: de spelregel "eindklassement pas na ≥11 etappes"
   wordt niet in code afgedwongen.

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
