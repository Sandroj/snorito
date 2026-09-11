# Snorito — uit/aan-schakelaar

Snorito is **stopgezet op 2026-07-30** om Neon-kosten te vermijden. Data blijft
intact; dit bestand beschrijft de uit-stand en hoe je alles weer aanzet zodra er
een volgende wielerkoers speelt.

## Waarom het geld kostte

De compute van Neon bleef 24/7 wakker omdat er constant iets de database raakte:
de in-process sync (elke 2 min), de keepalive-ping, de uitslagen-sync en de
backup-job. Zet je álle verkeer stil, dan schaalt Neon vanzelf naar nul.

## Uit-stand (wat is gedaan op 2026-07-30)

Software-kant (door Claude, omkeerbaar):
- [x] Verse backup getrokken en lokaal bewaard:
      `backups/shutdown-2026-07-30/snorito-backup-30533839607/snorito-backup.json`
      (8 users, 1 poule, 80 teams, 693 opstellingen, alle uitslagen/punten).
- [x] GitHub-workflows uitgezet: `Backup`, `Keep-alive`, `Uitslagen sync`
      (`gh workflow disable <naam>` — status `disabled_manually`).
- [x] Geplande Claude-taak `snorito-ochtendcheck` gepauzeerd.

Dashboard-kant (door Max gedaan; stand gecontroleerd 2026-09-11):
- [x] **Render** → service `snorito` → **Suspend** (geverifieerd: `/healthz`
      geeft 503 "This service has been suspended by its owner").
- [x] **cron-job.org** → de `/healthz`-ping uit (niet zelf te controleren;
      volgens `notes/projectstatus.md` gedaan).
- [x] **Neon** → plan **Launch → Free** (idem, volgens projectstatus).

**Let op de backup:** `backups/` staat in `.gitignore` (bevat accountdata) en
bestaat dus alleen op deze Mac. Wil je hem veiligstellen, kopieer de map
`backups/shutdown-2026-07-30/` handmatig naar Drive of een externe schijf.
Zolang Neon het project niet verwijdert staat de data daar ook nog.

## Weer aanzetten (volgende koers)

1. **Neon** → plan terug naar **Launch** (Free-tier suspendt en kan bij drukte
   knellen). Controleer dat `DATABASE_URL` in Render nog klopt.
2. **Render** → service `snorito` → **Resume**. Wacht tot `/healthz` 200 geeft.
3. GitHub-workflows weer aan:
   `gh workflow enable backup.yml keepalive.yml pcs-sync.yml`
   (of GitHub → Actions → per workflow → Enable).
4. Nieuwe koers configureren in de admin (etappes, renners, marktwaardes) —
   zie `AGENTS.md` voor de importflow. De oude Tour-data blijft staan tenzij
   je bewust herseedt (**nooit herseeden = accounts + poules wissen**).
5. Optioneel: `snorito-ochtendcheck` weer inschakelen als je monitoring wilt.

## Cloudflare-factuur (vraag kwam 2x terug op 2026-08-04)

Een **€0-invoice van Cloudflare is normaal** — dat is de gratis-plan
bevestigingsmail, geen actie nodig, niet opzeggen. Cloudflare zit vóór de site
(TLS/DNS); opzeggen breekt DNS. Alleen een factuur die *niet* €0 is is het
bekijken waard. (Ook gevraagd of Lovable, dat aan het sluimerende
worldmap-project hangt, een lopend maandabonnement is — nog niet geverifieerd,
zie `projects/worldmap/HANDOFF.md`.)

## Terugzetten uit backup (alleen bij dataverlies)

De JSON hierboven is een volledige export. Herstellen gaat via het bestaande
backup/restore-pad (`/api/cron/backup` maakt hem; restore-import zit in de
admin/importlaag). Herstel nooit met directe SQL op productie — zie AGENTS.md.
