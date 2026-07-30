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

Dashboard-kant (moet Max doen — buiten Claude's bereik):
- [ ] **Render** → service `snorito` → **Suspend** (stopt de in-process sync =
      grootste kostendrijver; site gaat volledig offline).
- [ ] **cron-job.org** → de `/healthz`-ping op pauze/uit.
- [ ] **Neon** → project → plan van **Launch → Free** voor écht €0. Op Launch
      blijft een vaste basis (~$5/mnd) staan, ook als compute op nul staat.
      Kan pas veilig terug naar Free zodra al het bovenstaande verkeer stil is
      (anders raakt de Free-tier 100 CU-uren weer op).

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

## Terugzetten uit backup (alleen bij dataverlies)

De JSON hierboven is een volledige export. Herstellen gaat via het bestaande
backup/restore-pad (`/api/cron/backup` maakt hem; restore-import zit in de
admin/importlaag). Herstel nooit met directe SQL op productie — zie AGENTS.md.
