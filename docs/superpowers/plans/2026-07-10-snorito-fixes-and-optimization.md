# Snorito: Vier Features + Snelheidsoptimalisatie

> **Voor agentic workers:** REQUIRED SUB-SKILL: Gebruik superpowers:subagent-driven-development (aanbevolen) of superpowers:executing-plans voor implementatie van deze plan taak-voor-taak. Stappen gebruiken checkbox (`- [ ]`) syntax voor tracking.

**Doel:** (1) Uitgevallen renners van selectie uitsluiten, (2) ze als uitgevallen weergeven in klassement, (3) uitslagen-UI refactoreren (één accordion, vorige in dropdown), (4) site drastisch versnellen.

**Architectuur:** 
- Deel 1-2: API-layer (`last_started_stage` check) + client-UI (filter, indicator).
- Deel 3: UI-refactor (herbruikbare accordion-component, dropdown voor vorige etappes).
- Deel 4: Bundel-optimalisatie (lazy load, tree-shake), server-caching, request-batching, query-optimalisatie.

**Tech Stack:** React 18 + TypeScript, Express, Neon Postgres, Vite (bundler).

---

## DEEL 1: Uitgevallen Renners Niet Selecteerbaar

### Task 1: API-layer: Renners als beschikbaar markeren

**Files:**
- Modify: `server/src/index.js` GET `/api/riders` respons

**Context:** Renners hebben een `last_started_stage` kolom (null = nog niet gestart/uit). Een renner is "actief" als `last_started_stage >= huidge_etappe_nr` OF `last_started_stage` is null (nog niet gestart).

- [ ] **Step 1:** Open `server/src/index.js`, find de `GET /api/riders` handler.

- [ ] **Step 2:** Bepaal huidge etappe: voeg `const currentStage = await db.get('SELECT MAX(nr) as max FROM stages WHERE status != ?', ['open'])` toe (geeft laatst gestarte etappe).

- [ ] **Step 3:** Map van renners in respons moet `available: boolean` krijgen. Voor elke renner:
```javascript
available: rider.last_started_stage === null || rider.last_started_stage >= (currentStage?.max || 999)
```

- [ ] **Step 4:** Commit: `Add 'available' flag to riders API response based on last_started_stage`

---

### Task 2: Client: Renners filteren in Team.tsx

**Files:**
- Modify: `client/src/pages/Team.tsx`

- [ ] **Step 1:** In het `canAdd(r: Rider)` function (around lijn 52-57), voeg check toe:
```typescript
const canAdd = (r: Rider) => {
  if (!r.available) return false;  // <-- new
  if (selected.size >= TEAM_SIZE) return false;
  if ((perTeamCount[r.team_id] || 0) >= MAX_PER_TEAM) return false;
  if (r.price > remaining - reserveNeeded) return false;
  return true;
};
```

- [ ] **Step 2:** Update de `Rider` interface in `client/src/api.ts` om `available?: boolean` toe te voegen.

- [ ] **Step 3:** Maak gebruiker duidelijk waarom renners niet selecteerbaar zijn: voeg CSS-class toe voor disabled renners:
   - In Team.tsx render, voeg `className={!r.available ? 'rider-unavailable' : ''}` toe aan de renner-rij.
   - Voeg toe in `client/src/App.css` (of equivalent): 
   ```css
   .rider-unavailable { opacity: 0.5; cursor: not-allowed; }
   ```

- [ ] **Step 4:** Test lokaal: check dat al opgeslagen teams renners kunnen behouden, maar nieuwe selectie ze niet kan kiezen.

- [ ] **Step 5:** Commit: `Fix: prevent selecting retired riders when building new team`

---

## DEEL 2: Uitgevallen Renners als Uitgevallen Weergeven in Klassement

### Task 3: Voeg 'retired' flag toe aan renner-data in klassement

**Files:**
- Modify: `server/src/index.js` GET `/api/participants/{userId}` + GET `/api/participants/{userId}/points/{stageNr}`

- [ ] **Step 1:** Bepaal huidge etappe (zelfde als Task 1, Step 2).

- [ ] **Step 2:** In beide endpoints, update de teamleden-respons: voeg `retired: boolean` toe aan elke renner:
```javascript
retired: rider.last_started_stage !== null && rider.last_started_stage < currentStage
```

- [ ] **Step 3:** Commit: `Add 'retired' indicator to team riders in participant endpoints`

---

### Task 4: Weergave: Uitgevallen renners visueel markeren in Ranking

**Files:**
- Modify: `client/src/pages/Ranking.tsx` + `client/src/components/RiderInfo.tsx` + CSS

- [ ] **Step 1:** Update `RiderInfo.tsx` interface: voeg `retired?: boolean` parameter toe.

- [ ] **Step 2:** In `RiderInfo` render, voeg visuele indicator toe (bijv. achter de naam):
```typescript
{retired && <span className="chip chip-grijs" title="Uitgevallen">UIT</span>}
```

- [ ] **Step 3:** Update `Ranking.tsx` ParticipantDetail sectie (rond lijn 100-110): pas renners-tabel aan om `retired` prop door te geven aan RiderInfo.

- [ ] **Step 4:** Test: ga in klassement naar detail van een deelnemer die renners heeft die zijn uitgevallen. Ze moeten een "UIT"-label hebben.

- [ ] **Step 5:** Commit: `Display retired riders as 'UIT' in team listings under Ranking`

---

## DEEL 3: Uitslagen UI: Alleen Laatste Etappe Uitgeklapt + Vorige in Dropdown

Dit is een UI-refactor die Points.tsx en Ranking.tsx aanraakt. We maken een herbruikbare accordion-component met "toon vorige" dropdown.

### Task 5: Maak herbruikbare StageAccordion-component

**Files:**
- Create: `client/src/components/StageAccordion.tsx`
- Modify: `client/src/api.ts` (voeg `StageScore` interface toe als export)

- [ ] **Step 1:** Schrijf nieuwe component:
```typescript
import { useState } from 'react';

export interface AccordionStage {
  stageNr: number;
  points: number;
  label: string;
}

export function StageAccordion({ 
  stages, 
  onStageOpen, 
  isLoading 
}: { 
  stages: AccordionStage[];
  onStageOpen: (nr: number) => void;
  isLoading: boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  if (stages.length === 0) return null;

  // Sorteer op nummer, laatste eerst
  const sorted = [...stages].sort((a, b) => b.stageNr - a.stageNr);
  const latest = sorted[0];
  const previous = sorted.slice(1);

  return (
    <div className="stage-accordion">
      {/* Laatste etappe — altijd zichtbaar, default open */}
      <div key={latest.stageNr} className="card">
        <div 
          className="acc-head" 
          onClick={() => {
            const newVal = expanded === latest.stageNr ? null : latest.stageNr;
            setExpanded(newVal);
            if (newVal) onStageOpen(latest.stageNr);
          }}
        >
          <b>{latest.label}</b>
          <span className="pts">{latest.points} pt</span>
        </div>
        {expanded === latest.stageNr && (
          isLoading ? <div className="muted">Laden…</div> : children
        )}
      </div>

      {/* Vorige etappes in dropdown */}
      {previous.length > 0 && (
        <div className="card previous-stages">
          <div 
            className="acc-head" 
            onClick={() => setShowPrevious(!showPrevious)}
          >
            <b>Vorige etappes ({previous.length})</b>
            <span>{showPrevious ? '▼' : '▶'}</span>
          </div>
          {showPrevious && (
            <div className="previous-list">
              {previous.map(s => (
                <div 
                  key={s.stageNr}
                  className="acc-head prev-item"
                  onClick={() => {
                    setExpanded(s.stageNr);
                    onStageOpen(s.stageNr);
                  }}
                >
                  <span>{s.label}</span>
                  <span className="pts">{s.points} pt</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Voeg styling toe in `client/src/App.css`:
```css
.stage-accordion { margin-top: 12px; }
.previous-stages .previous-list { max-height: 400px; overflow-y: auto; }
.previous-list .prev-item { 
  padding: 8px 12px; 
  border-top: 1px solid #e5e7eb; 
  cursor: pointer;
  font-size: 0.9em;
}
.previous-list .prev-item:hover { background: #f3f4f6; }
```

- [ ] **Step 3:** Commit: `Create reusable StageAccordion component for stage listings`

---

### Task 6: Refactor Points.tsx om StageAccordion te gebruiken

**Files:**
- Modify: `client/src/pages/Points.tsx`

- [ ] **Step 1:** Import StageAccordion:
```typescript
import { StageAccordion, AccordionStage } from '../components/StageAccordion';
```

- [ ] **Step 2:** In `Points`, simplifeer de render naar:
```typescript
return (
  <div className="fade-in">
    <h1>Mijn uitslagen</h1>
    <div className="total-hero">
      <div className="lab">Totaalscore</div>
      <div className="big">{total}</div>
      <div className="lab">{scores.length > 0 ? `over ${scores.length} verwerkte ronde${scores.length !== 1 ? 's' : ''}` : 'nog geen etappes verwerkt'}</div>
    </div>

    {scores.length === 0 && (
      <div className="card empty">
        <div className="emoji">⏱️</div>
        Zodra de eerste etappe is verwerkt zie je hier je uitslag per etappe…
      </div>
    )}

    {scores.length > 0 && (
      <StageAccordion 
        stages={scores.map(s => ({ stageNr: s.stageNr, points: s.points, label: s.stageNr === 0 ? 'Eindklassement' : `Etappe ${s.stageNr}` }))}
        onStageOpen={(nr) => setOpenStage(nr)}
        isLoading={openStage != null && detail == null}
      >
        {detail && <Daguitslag d={detail} />}
      </StageAccordion>
    )}
  </div>
);
```

- [ ] **Step 3:** Verwijder de oude `map().filter()` render-logica.

- [ ] **Step 4:** Test: zorg dat "Mijn uitslagen" de laatste etappe open toont, vorige in dropdown.

- [ ] **Step 5:** Commit: `Refactor Points page to use StageAccordion`

---

### Task 7: Refactor Ranking.tsx om StageAccordion te gebruiken

**Files:**
- Modify: `client/src/pages/Ranking.tsx` (ParticipantDetail component)

- [ ] **Step 1:** Import StageAccordion.

- [ ] **Step 2:** Update ParticipantDetail om StageAccordion te gebruiken (vergelijk met Task 6, Step 2).

- [ ] **Step 3:** Test: open klassement, klik op deelnemer, zorg dat vorige etappes in dropdown zitten.

- [ ] **Step 4:** Commit: `Refactor Ranking ParticipantDetail to use StageAccordion`

---

## DEEL 4: Snelheidsoptimalisatie

Dit is de grootste stap. Zeven sub-taken: caching, lazy-loading, request-batching, query-opt, bundle-split.

### Task 8: Server-side: Intelligente caching voor `/api/riders`

**Files:**
- Modify: `server/src/cache.js` + `server/src/index.js`

- [ ] **Step 1:** Open `server/src/cache.js`. Zorg dat de cache een TTL heeft (geef minstens 5 minuten retentie).

- [ ] **Step 2:** In `index.js`, voeg cache-header toe aan `/api/riders`:
```javascript
// Voeg dit toe voorafgaand aan res.json():
res.set('Cache-Control', 'public, max-age=300'); // 5 min
```

- [ ] **Step 3:** Controleer: als renners statisch zijn gedurende een sessie, return uit `memCache` van server-cache voordat database wordt benaderd.

- [ ] **Step 4:** Commit: `Add aggressive caching to /api/riders (5 min TTL)`

---

### Task 9: Server-side: Batch-query optimalisatie voor klassement

**Files:**
- Modify: `server/src/index.js` GET `/api/pools/{poolId}/ranking` (of gelijkaardig klassement-endpoint)

**Context:** Ranking vergt waarschijnlijk meerdere queries (gebruikers, scores, teams). Optimaliseer naar één query met joins waar mogelijk.

- [ ] **Step 1:** Vind het ranking-endpoint in index.js.

- [ ] **Step 2:** In plaats van looping over deelnemers en per deelnemer queries doen, write een single SQL-query die alle scores per gebruiker in één gang ophalt:
```sql
SELECT u.id, u.name, 
       COALESCE(SUM(CASE WHEN sr.score IS NOT NULL THEN sr.score ELSE 0 END), 0) as total
FROM users u
LEFT JOIN stage_results sr ON u.id = sr.user_id
WHERE u.id IN (SELECT DISTINCT user_id FROM pool_members WHERE pool_id = ?)
GROUP BY u.id, u.name
ORDER BY total DESC
```

- [ ] **Step 3:** Controleer indexing: `CREATE INDEX IF NOT EXISTS idx_stage_results_user ON stage_results(user_id)` (voeg toe in schema-init).

- [ ] **Step 4:** Commit: `Optimize ranking query: single batch SELECT instead of loop`

---

### Task 10: Client-side: Lazy-load details (ParticipantDetail + Daguitslag)

**Files:**
- Modify: `client/src/pages/Ranking.tsx`

**Context:** Beim openen van Ranking-detail laad je nu het hele team + alle etappes. Laad alleen wat nodig is.

- [ ] **Step 1:** In `ParticipantDetail`, split data-load in twee calls:
   - Eerst: `GET /api/participants/{userId}` → naam, totaal, team (lichte load).
   - Dan: pas bij klik op etappe: `GET /api/participants/{userId}/points/{stageNr}` → etappe-details.

- [ ] **Step 2:** Dit gebeurt al! Maar controleer dat je geen overbodige requests doet: bij mount mag NIET alle etappes tegelijk fetcht worden.

- [ ] **Step 3:** Commit: `Verify lazy-loading of stage details in Ranking`

---

### Task 11: Client-side: React.memo + useMemo voor heavy renders

**Files:**
- Modify: `client/src/components/RiderInfo.tsx` + `client/src/components/Daguitslag.tsx`

- [ ] **Step 1:** In `RiderInfo.tsx`: wrap als `export const RiderInfo = memo(function RiderInfo(props) { ... })`.

- [ ] **Step 2:** In `Daguitslag.tsx`: wrap `PointTable` als memo component.

- [ ] **Step 3:** In `Points.tsx` + `Ranking.tsx`: use `useMemo` voor de `stages` array in StageAccordion (preventer herberekening).

- [ ] **Step 4:** Test: check React DevTools Profiler dat renderen sneller is (minder re-renders).

- [ ] **Step 5:** Commit: `Memoize heavy components (RiderInfo, Daguitslag, PointTable)`

---

### Task 12: Bundle-optimalisatie: Code-splitting voor pages

**Files:**
- Modify: `client/src/App.tsx` (route definitions)

**Context:** Lazy-load Pages (Admin, Pools, Ranking, etc.) zodat het initial bundle kleiner is.

- [ ] **Step 1:** Installeer niet nodig — React Router ondersteunt al lazy met `React.lazy()`.

- [ ] **Step 2:** Update App.tsx route definitions:
```typescript
import { lazy, Suspense } from 'react';

const Team = lazy(() => import('./pages/Team'));
const Ranking = lazy(() => import('./pages/Ranking'));
const Points = lazy(() => import('./pages/Points'));
const Pools = lazy(() => import('./pages/Pools'));
const Admin = lazy(() => import('./pages/Admin'));
// ... rest

<Route path="/mijn-team" element={<Suspense fallback={<div>Laden…</div>}><Team /></Suspense>} />
// ... other routes
```

- [ ] **Step 3:** Test bundle size: `npm run build`, controleer dat initial JS ~30% kleiner is (Ranking/Pools/Admin worden apart fetcht).

- [ ] **Step 4:** Commit: `Add code-splitting with React.lazy for all pages`

---

### Task 13: Gzip compression + cache-busting voor assets

**Files:**
- Modify: `server/src/index.js` (static file serving)

- [ ] **Step 1:** Voeg gzip compression toe (als nog niet aanwezig):
```javascript
import compression from 'compression';
app.use(compression());
```

- [ ] **Step 2:** Zorg dat client assets (`dist/`) cache-headers hebben:
```javascript
// static files: cache 1 year (omdat Vite hash in filename stopt)
app.use(express.static('client/dist', {
  maxAge: '1y',
  etag: false
}));
```

- [ ] **Step 3:** HTML-bestand (index.html) mag NIET gecached worden:
```javascript
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(process.cwd(), 'client/dist/index.html'));
});
```

- [ ] **Step 4:** Commit: `Enable gzip compression and cache busting for assets`

---

### Task 14: Database-indexering voor hot queries

**Files:**
- Modify: `server/src/db.js` (schema init)

- [ ] **Step 1:** Voeg performance-kritische indexes toe (na schema creation):
```sql
CREATE INDEX IF NOT EXISTS idx_stage_results_user_stage ON stage_results(user_id, stage_nr);
CREATE INDEX IF NOT EXISTS idx_pool_members_pool ON pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_riders_team ON riders(team_id);
CREATE INDEX IF NOT EXISTS idx_riders_available ON riders(last_started_stage);
```

- [ ] **Step 2:** Check Neon console voor query plans (zorg dat belangrijkste queries indexes gebruiken).

- [ ] **Step 3:** Commit: `Add database indexes for hot query paths`

---

### Task 15: Monitoring + verifiy performance

**Files:**
- Inspect: `server/src/index.js` (endpoints, timing)

- [ ] **Step 1:** Voeg req/resp timing toe (lokaal, voor debugging):
```javascript
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 100) console.log(`${req.method} ${req.path} ${ms}ms`);
  });
  next();
});
```

- [ ] **Step 2:** Na push naar live: controleer Render logs op slow requests. Optimaliseer de traagste endpoints verder.

- [ ] **Step 3:** Browser DevTools: open Network tab, reload site, controleer dat:
   - initial page load < 2s
   - eerste interactieve element < 1s
   - JSON-responses < 500ms

- [ ] **Step 4:** Commit: `Add request timing logs for performance monitoring`

---

## Test Plan

- [ ] Team-selectie: probeer uitgevallen renners toe te voegen → lukt niet, worden gegrijd.
- [ ] Klassement-detail: deelnemers met uitgevallen renners tonen "UIT"-label.
- [ ] Uitslagen: laatste etappe open, vorige in dropdown (beide in Points en Ranking).
- [ ] Performance: LiveCSS reload < 500ms, klassement-pagina load < 1s, API calls < 200ms.

---

## Toekomstige optimalisaties (niet in deze plan)

- Service Worker caching voor offline ondersteuning (PWA verbetering).
- Streaming updates via WebSocket voor live scores (i.p.v. polling).
- Database query result streaming (voor zeer grote klassementen).

---

## Deployment Checklist

1. **Lokaal:** npm run build, verify no TS errors, verify performance in DevTools.
2. **Push:** git commit + push naar main.
3. **Live:** Render auto-deploys. Controleer `/healthz` en Render logs op fouten.
4. **Post-deploy:** Handmatige test in live app: team-selectie, klassement-detail, uitslagen.
