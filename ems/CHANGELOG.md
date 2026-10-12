# Changelog

## 0.1.6 - 2026-10-12

- Centreer ampere en voltage samen onder het fasevermogen.
- Geef Zonnepanelen de voorbeeldopmaak met productiestatus, uurstaafgrafiek, dimslider en vier opbrengstvelden.
- Bereken de zonne-uurwaarden uit dezelfde historie als het dagtotaal; toon ontbrekende historie expliciet.
- Voeg een optionele Wh/kWh-dagmeter voor Zonneopbrengst vandaag toe, met voorrang boven de historieschatting.
- Gebruik dezelfde daadwerkelijke klimaatstatus in energiestromen en kamerbronnen; benoem modus apart wanneer activiteit ontbreekt.
- Toon een aanwezigheidsbadge alleen bij een gekoppelde eigen kamersensor met bekende status; behoud huishoudelijke aanwezigheid voor optionele regeling.
- Vervang de gas-totaalstand door verbruikstotalen bij de 24-uurs-, week- en 30-dagengrafiek, met expliciete onvolledige historie.
- Voeg optionele bevestigde aan/uitschakelaars aan bekende verbruikers toe; uit rood, aan wit op basis van schakelstatus.
- Geef water dezelfde opmaak en periodetotalen als gas, zonder cumulatieve totaalstand.
- Beperk de dagrecap tot woningverbruik, teruglevering, laadpaal, batterij laden/ontladen en optionele gas/waterdagtotalen sinds middernacht.

## 0.1.5 - 2026-10-12

- Werk kamer-aanwezigheid ook met person- en device_tracker-entiteiten; ververs zichtbare waarden elke 10 seconden.
- Voeg laadkabel-, slot-, sessie-kWh- en fasestroomkoppelingen toe aan Laadpaal.
- Voeg een bevestigde, versheidsgecontroleerde accu-aan/uitbediening toe achter HA-vrijgave; toon input, output, resterende tijd en optionele health.
- Voeg een beveiligde 0–100%-zonnedimmerslider toe en vergelijk forecast met werkelijke productie.
- Toon fasekaarten als drie uitgelijnde kolommen met gemeten kW of correct gelabelde VA, plus A en V.
- Voeg een kW/W-schakelaar met Nederlandse duizendtalsnotatie toe.
- Toon de vrijgavestatus in plaats van Proefmodus wanneer echte apparaatsturing is toegestaan.
- Groepeer Koppelingen per onderwerp en centreer de faselabels.
- Geef Laadpaal en Accu de apparaatgerichte voorbeeldopmaak met centraal apparaatbeeld, hoofdknop en compacte metingen.
- Voeg bevestigde laadpaalbediening toe voor starten/stoppen, kabelvergrendeling en een laadstroomlimiet van 6–32 A binnen het entiteitsbereik.
- Toon Opwek vandaag naast de zonneverwachting; markeer onvolledige historie als schatting.
- Pas de zonnelimiet toe bij loslaten van de slider, na toestemming per entiteit voor de huidige browsersessie.
- Bewaar een instelbaar verversingsinterval van 5, 10, 30 of 60 seconden, of alleen handmatig; onderbreek geen open dialogen of sliderbediening.

## 0.1.4 - 2026-10-12

- Maak warmtebronnen en Stroomregels aan in browsers zonder `crypto.randomUUID()`; de mobiele Stroom-knop opent de editor.
- Beheer aanwezigheid alleen op Mijn wensen en bewerk eigen namen voor bekende verbruikers.
- Voeg een schakelbare dark mode en een inklapbaar mobiel zijmenu toe.
- Toon gas- en waterhistorie alleen na opt-in op Mijn wensen, onder Warmte in huis.
- Voeg een elektrische dagrecap en conditionele detailtabs voor laadpaal, accu en zonnepanelen toe.
- Toon optionele accuhealth op de accu-detailpagina wanneer Home Assistant die sensor aanbiedt.
- Vergelijk optioneel verwacht zonnevermogen nu en verwachte dagopbrengst met gemeten productie.
- Toon gekoppelde fasestroom en spanning met correct gelabeld schijnbaar vermogen in VA.

## 0.1.3 - 2026-10-12

- Maak warmtebronnen en Stroomregels aan in browsers zonder `crypto.randomUUID()`.
- Verwijder aanwezigheid uit Koppelingen; beheer dit via Mijn wensen.
- Geef geselecteerde verbruikers een eigen bewerkbare weergavenaam.
- Voeg een handmatig schakelbare dark mode toe, standaard afgestemd op de apparaatvoorkeur.
- Vervang de mobiele navigatierij door een inklapbaar zijmenu.

## 0.1.2 - 2026-10-12

- Lees de Supervisor-optie voordat de server als niet-rootgebruiker start.

## 0.1.1 - 2026-10-12

- Toon de oorspronkelijke fout en stacktrace wanneer de app niet kan starten.

## 0.1.0 - Nog niet uitgebracht

- Compact live warmteoverzicht op het algemene dashboard, met gedeelde kamerweergave en doorklik naar Warmte.
- Meerdere personen/device_trackers/aanwezigheidssensoren selecteren, met minstens-een/iedereen-thuis-keuze.
- Expliciete afwezigheidsregeling per kamer, geen zonneboost bij afwezigheid en blokkering bij onbekende aanwezigheid.
- Getest dat zonneboost een absoluut kamerdoel plus verhoging gebruikt en niet cumulatief doorverhoogt.
- Alleen-lezen Home Assistant-entiteitenkoppeling met type- en eenheidsfilters.
- Energieoverzicht, comfort- en laadwensen, lokale opslag en demomodus.
- Getekende net- en batterijmeters met instelbare tekenrichting.
- Direct of berekend woningverbruik en bekende/niet-toegewezen verbruiksuitsplitsing.
- Keuze tussen losse apparaatmetingen en een bestaande bekende-verbruikstotaalsensor.
- Verwarmingsprofielen met genuanceerd advies, zonder automatische apparaatsturing.
- Apart Warmte-scherm met zelf aangemaakte kamers per verdieping, meerdere bronnen per kamer en gedeelde brondefinities.
- Plus-, bewerk- en verwijderdialogen; gemeten temperaturen en bronstatussen verversen mee.
- Verwarmingsadvies verwijderd van het energieoverzicht; advies blijft bij de instellingen.
- Werkelijke HVAC-activiteit onderscheiden van alleen de ingestelde modus.
- Ingressconfiguratie, multi-architectuurcontainerworkflow en gerichte backendtests.
- Eigen als/dan/anders-regels voor thermostaatdoel, verwarmmodus, laadstart/stop, stroomlimiet, batterijvermogen en PV-begrenzing.
- Regelrunner aangesloten op de server; proefmodus, actuele beoordeling en pauzeknop.
- Actieve sturing alleen na standaard-uit appvrijgave en expliciete bevestiging, nooit in demo.
- Grens- en versheidscontrole, apparaatbevestiging, tijdelijke handmatige pauze en geen automatische herhaling bij onzekere opdrachten.
- Na herstart of regelwijziging terug naar proefmodus; geen AI-beslissingen in V1.
- Regelprioriteiten 1-100, standaard 50, toegepast op beoordeling en uitvoervolgorde.
- Doorzoekbare Home Assistant-entiteitenlijsten met naam, ID en eenheid voor voorwaarden en acties.
- Warmte aangesloten op de gecontroleerde uitvoerlaag, met eigen modus en pauze.
- Begrensde airco-zonnevoorverwarming met eigen vermogensmeting, start/stopwachttijden en dagelijkse periode.
- Maximaal een gelijktijdige zonneboost; onbekende of ontladende batterij blokkeert extra verwarmen.
- Container-smoke-tests voor amd64/arm64 als publicatiegate en een beschreven Home Assistant OS-pilot.