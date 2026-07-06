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
