# HANDOFF — Snorito (scorita)

> Levend statusbestand + startpunt voor de volgende AI-sessie. Kort en concreet.
> Architectuur, valkuilen en runbook staan in `AGENTS.md` — hier alleen de stand.

## Waar staan we
**Live product** op https://snorito-2j6w.onrender.com (Render free tier), Neon
Postgres. De Tour de France 2026 loopt **t/m 26 juli 2026** — echte gebruikers,
dus terughoudend met refactors op koersdagen. Deploy = commit + push naar `main`
(Render bouwt en rolt automatisch uit; geen staging).

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
