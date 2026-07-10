# HANDOFF — Snorito (scorita)

> Levend statusbestand + startpunt voor de volgende AI-sessie. Kort en concreet.
> Architectuur, valkuilen en runbook staan in `AGENTS.md` — hier alleen de stand.

## Waar staan we
**Live product** op https://snorito-2j6w.onrender.com (Render free tier), Neon
Postgres. De Tour de France 2026 loopt **t/m 26 juli 2026** — echte gebruikers,
dus terughoudend met refactors op koersdagen. Deploy = commit + push naar `main`
(Render bouwt en rolt automatisch uit; geen staging).

## Laatst gedaan (2026-07-10)
- **Query-optimalisatie — Klassement-endpoint:** Herschreven `/api/ranking`-query
  van vijf scalar subqueries per gebruiker naar single LEFT JOIN + GROUP BY:
  - In index.js regel 646: vervangen `(SELECT SUM(...) WHERE user_id = u.id)` etc.
    met `SUM(CASE WHEN ... THEN ... END)` in één query
  - In db.js: indexes toegevoegd op user_scores(user_id, stage_nr) en
    pool_members(pool_id, user_id)
  - Build verifieërd (tsc + vite), commit geslaagd (c11ae3d)
  - Status: Gereed, klassement-requests veel sneller (eliminates N+5 DB calls)

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
