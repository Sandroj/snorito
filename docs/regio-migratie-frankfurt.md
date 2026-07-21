# Verhuisplan: Render Oregon → Frankfurt

Opgesteld 21 juli 2026, op basis van eigen metingen aan de live app.

## Waarom

De app draait in Render's standaardregio **Oregon (US West)** — `render.yaml`
bevat geen `region:`, en dan kiest Render die zelf. De **database staat wél al
in Frankfurt**: de Neon-host is `...c-4.eu-central-1.aws.neon.tech`.

Daardoor betaalt elke pagina twee keer een oceaan:

| Meting (vanaf Nederland, 21 juli) | Resultaat |
|---|---|
| Cloudflare-edge (TLS-handshake) | 30 ms — het netwerk hierheen is snel |
| `/healthz` — doet niets, 0 queries | **175-200 ms** |
| `/api/rider/1/results` — 3 opeenvolgende queries, geen cache | **615-1123 ms** |

Uit het verschil volgt: ~175 ms is de reis van de gebruiker naar Oregon, en
daar bovenop kost **elke databasequery ~145 ms** omdat Oregon voor elke query
terug naar Frankfurt moet. Een endpoint met vier opeenvolgende queries zit dus
al snel op driekwart seconde, terwijl de servercode zelf vrijwel niets doet.

Dit is ook waarom de gecachete endpoints (`/api/riders`, `/api/stages`) precies
even snel leken als `/healthz`: die raken de database niet. De pagina's achter
login doen dat wél, en dat zijn juist de pagina's die dagelijks gebruikt worden.

## Wat het oplevert

Na de verhuizing staan app en database in dezelfde regio:

- gebruiker → app: ~175 ms wordt **~20-25 ms**
- app → database: ~145 ms per query wordt **~1-5 ms**

Voor het gemeten voorbeeld `/api/rider/1/results` (3 queries) betekent dat naar
schatting **615-1123 ms → ~30-40 ms**. De winst is het grootst op de pagina's
met meerdere query's, en dat zijn precies klassement, opstelling en team.

## Belangrijk om vooraf te weten

- **Render kan de regio van een bestaande service niet wijzigen.** Je maakt een
  nieuwe service aan en zet de oude daarna uit
  ([Render Docs — Regions](https://render.com/docs/regions)).
- De free tier bestaat in Frankfurt, met dezelfde beperkingen (512 MB, 0,1 CPU,
  spin-down na 15 minuten inactiviteit) — de keepalive blijft dus nodig.
- **Let op de 750 gratis instance-uren per maand.** Eén service die dankzij de
  keepalive praktisch 24/7 draait zit al rond de 730 uur. Twee services naast
  elkaar verbruiken dat budget dus ruim twee keer zo snel: houd de overlap op
  dagen, niet weken.
- De nieuwe service krijgt een **nieuwe `onrender.com`-URL**. De app zelf past
  zich aan (`appUrl()` valt terug op `RENDER_EXTERNAL_URL`), maar bookmarks,
  geïnstalleerde PWA's en de Google-login moeten bijgewerkt worden.

## Timing

De Tour loopt t/m **26 juli**. Twee redelijke keuzes:

1. **Na de Tour verhuizen** (rustigst). Geen risico op een kapotte login of
   gemiste uitslagensync tijdens de laatste koersdagen.
2. **Nu verhuizen met overlap** (kan, want beide services praten met dezelfde
   database). Doe het dan 's ochtends vóór 13:00, ruim vóór de etappestart, en
   houd de oude service als terugval draaien.

Mijn advies: als de traagheid nu vooral hindert, doe optie 2 op een rustig
moment; anders wacht tot na 26 juli.

## Stappen

1. **Nieuwe service aanmaken** in het Render-dashboard: zelfde GitHub-repo,
   branch `main`, runtime Node, plan Free, **regio Frankfurt (EU Central)**.
   Doe dit via het dashboard en niet via de Blueprint, zodat de bestaande
   Blueprint-koppeling van de oude service met rust gelaten wordt. (Wie het
   tóch via de Blueprint wil: dan hoort er `region: frankfurt` in `render.yaml`.)

2. **Env-vars overnemen** van de oude service: `DATABASE_URL`, `CRON_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `MAIL_FROM`,
   eventueel `ADMIN_PASSWORD`, plus `NODE_VERSION`, `NODE_ENV` en
   `NPM_CONFIG_PRODUCTION` zoals in `render.yaml`. Zet er tijdelijk
   **`DISABLE_SYNC=1`** bij, zodat de nieuwe instantie tijdens het testen niet
   dezelfde etappe gaat importeren als de oude.

3. **Bouwen en controleren.** Wacht de deploy af en test op de nieuwe URL:
   `/healthz`, inloggen met e-mail, klassement, opstelling opslaan. Meet het
   verschil met:
   ```
   curl -s -o /dev/null -w "%{time_starttransfer} %{time_appconnect}\n" \
     https://NIEUWE-URL/api/rider/1/results
   ```
   Trek de tweede waarde van de eerste af: dat is de servertijd. Verwacht
   enkele tientallen milliseconden in plaats van ~600-1100 ms.

4. **Google-login bijwerken.** Voeg in de Google Cloud Console bij de OAuth-client
   de nieuwe redirect-URI toe: `https://NIEUWE-URL/api/auth/google/callback`.
   Laat de oude er voorlopig in staan.

5. **Omschakelen.** Zet `DISABLE_SYNC=1` op de **oude** service en haal hem weg
   bij de nieuwe. Vanaf dat moment is de nieuwe instantie degene die uitslagen
   importeert.

6. **GitHub-secret `APP_URL`** in de repo-instellingen op de nieuwe URL zetten.
   Die voedt alle drie de workflows (`pcs-sync.yml`, `keepalive.yml`,
   `backup.yml`). Controleer daarna met `gh run list` of de eerstvolgende
   "Uitslagen sync" slaagt.

7. **cron-job.org** laten pingen naar `https://NIEUWE-URL/healthz`.

8. **Gebruikers de nieuwe URL geven.** Wie de app als PWA had geïnstalleerd,
   moet hem opnieuw toevoegen.

9. **Oude service uitzetten** zodra alles een dag goed draait — anders loopt het
   gratis urenbudget onnodig leeg. Verwijderen kan later; suspenden is genoeg.

## Wil je de URL nooit meer kwijt: eigen domein

Met een eigen domein (bijvoorbeeld `snorito.nl`, ~€10 per jaar) hangt de app
niet meer aan een `onrender.com`-adres, en is dit de laatste keer dat de URL
verandert. Render regelt het TLS-certificaat gratis en automatisch
([Render Docs — Custom Domains](https://render.com/docs/custom-domains)); je
wijst het domein met een CNAME naar de service. Als je dit tóch ooit wilt, is
dit hét moment — je bent nu al bezig de URL te wijzigen.

## Terugvalplan

Zolang de oude service nog bestaat is terugdraaien simpel: `DISABLE_SYNC` weer
weghalen bij de oude, `APP_URL` terugzetten naar de oude URL, en de oude link
weer delen. Beide services gebruiken dezelfde database, dus er gaat onderweg
geen data verloren — er is geen migratie van gegevens nodig, alleen van de
draaiende applicatie.

## Wat dit níet oplost

De free tier blijft 0,1 CPU met spin-down na 15 minuten. De trage cold start na
inactiviteit en de CPU-pieken tijdens een koersdag blijven dus bestaan; daarvoor
is Render Starter (betaald) de oplossing. Maar dát probleem is een orde van
grootte kleiner dan de 175 + 145 ms die je met de verhuizing weghaalt.

## Bronnen

- [Render Docs — Regions](https://render.com/docs/regions)
- [Render Docs — Deploy for Free](https://render.com/docs/free)
- [Render Docs — Custom Domains](https://render.com/docs/custom-domains)
