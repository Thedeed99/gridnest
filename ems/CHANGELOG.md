# Changelog

## 2.0.0 - 2026-10-15

- Herstel het direct opnieuw tonen van het thema-icoon na wisselen tussen licht en donker.
- Verplaats alle tariefkeuzes naar het tabblad Tarieven, met vaste/dynamische contracten en prijsintervallen per dag, uur of 15 minuten.
- Bewaar vaste en dynamische tariefhistorie 45 dagen en toon die gegroepeerd per dag, uur of kwartier.
- Plan toekomstige vaste tarieven met een ingangsdatum en toon dynamische prijsforecasts voor de komende 24 uur.
- Beperk water tot een vast tarief.
- Beperk toekomstige prijswijzigingen tot maximaal twee per afzonderlijk tarief; activeer ze automatisch op de ingangsdatum.

## 1.0.14 - 2026-10-15

- Kies voor stroomverbruik en teruglevering onafhankelijk tussen één tarief of aparte lage en hoge tarieven.
- Koppel laag- en hoogtariefmeters afzonderlijk voor stroomverbruik en teruglevering; behoud oude totaalmeterkoppelingen als verborgen terugval.
- Hernoem Kosten naar Financieel met vandaag en deze maand, terugleveropbrengsten en saldo kosten.
- Vereenvoudig stroom naar één all-in kWh-tarief en ondersteun handmatige prijzen tot zes decimalen.
- Geef concreet aan welke meter, welk tarief of welke historie ontbreekt en behoud bekende dagbedragen bij ontbrekende maandprijzen.

## 1.0.13 - 2026-10-15

- Hernoem Kosten naar Financieel met vandaag en deze maand, terugleveropbrengsten en saldo kosten.
- Vereenvoudig stroom naar één all-in kWh-tarief en ondersteun handmatige prijzen tot zes decimalen.
- Voeg totale afname- en teruglevermeters toe; geef concreet aan welke meter, welk tarief of welke historie ontbreekt en behoud bekende dagbedragen bij ontbrekende maandprijzen.

## 1.0.12 - 2026-10-15

- Bewaar gekoppelde prijssensoren lokaal en bereken dynamische energiekosten per uur, vandaag, deze maand en over de afgelopen 30 dagen.
- Markeer ontbrekende tariefhistorie als onvolledig; behoud handmatige vaste tarieven.

## 1.0.11 - 2026-10-15

- Voeg een optioneel kostenoverzicht voor stroom, gas en water toe met handmatige tarieven of prijsentiteiten.
- Toon stroomkosten apart voor laag en hoog tarief; bied vandaag- en maandtotalen op het overzicht.

## 1.0.10 - 2026-10-14

- Houd het navigatiemenu zichtbaar tijdens scrollen op desktop; behoud het uitschuifmenu op mobiel.

## 1.0.9 - 2026-10-14

- Vul ontbrekende gas- en waterhistorie aan met Home Assistant-langetermijnstatistieken voor de grafieken over 30 dagen, zonder dubbele telling; behoud nulweergave bij ontbrekende data.

## 1.0.8 - 2026-10-14

- Toon de gekoppelde kamertemperatuur onder Warmte in Energiestromen, met de verwarmingsmodus eronder.

## 1.0.7 - 2026-10-13

- Toon bij het openen van Zonnepanelen direct de laatst bekende dagopbrengst en laad ondertussen verse dagrecapdata op de achtergrond.

## 1.0.6 - 2026-10-13

- Sta een maximale meetouderdom van 24 uur toe; de standaard blijft 15 minuten.
- Haal bij het openen van Zonnepanelen verse dagrecapdata op en verwijder de verouderde melding over onvolledige uurgrafiek.
- Activeer de knop voor batterij-min/max na afloop van de opdracht weer.
- Toon in de laadpaalbediening en statusregel een open slot bij ontgrendeling en een dicht slot bij vergrendeling.

## 1.0.5 - 2026-10-13

- Update meetwaarden op alle pagina's zonder de pagina of onderdelen opnieuw op te bouwen; behoud invoer en bedieningen.
- Laat automatische refresh de refreshknop ongemoeid; toon alleen voortgang bij handmatig vernieuwen.
- Gebruik light/dark theme-kleuren voor Zonnepanelen, Laadpaal en Batterij en kleur bestaande grafieken mee bij een themewissel.

## 1.0.4 - 2026-10-13

- Stuur Tado-kamerdoelen ook als de actuele kamertemperatuur ontbreekt of verouderd is; afwezigheidsregeling blijft op aanwezigheid gebaseerd.
- Toon bij de laadpaal Kabel vergrendeld of Kabel ontgrendeld in plaats van Aan/Uit.
- Bedien elke accuschakelaar per accu en toon de echte schakelaarstatus zonder bevestigingsdialoog.
- Bied verversen elke seconde aan voor snellere updates van de meetweergaven.
- Toon zonneproductie in halfuurvakken en behoud de laatste dagrecap tijdens verversen; de handmatige refresh ververst ook gas en water.

## 1.0.3 - 2026-10-13

- Bedien extra accuschakelaars via hun eigen batterijconfiguratie, zonder koppeling als bekende verbruiker.
- Gebruik beschikbare actuatoren en aanwezigheidsstatussen zonder freshness-timer; voeg een afwezigheidstemperatuur per kamer toe met Mijn wensen als terugval.
- Toon zonneproductie in de dagrecap en bereken cumulatieve zonne-energiemeters als dagverschil.
- Maak laadkabelontgrendeling onafhankelijk van een vermogensmeting; bediening blijft afhankelijk van Home Assistant-vrijgave en een geldige lock-entiteit.
- Neem de zonne-meterhelpers op in de Docker-buildstage.

## 1.0.2 - 2026-10-13

- Bereken Zonneopbrengst vandaag ook uit een cumulatieve Wh/kWh-meter, met Home Assistant-tijdzone en controle op ontbrekende beginstanden en tellerresets.
- Toon de UPS-status unused als Doorvoer en accepteer tekstwaarden voor de laadstatussensor.
- Beheer min/max-entiteitkoppelingen uitsluitend onder Koppelingen; behoud percentagebediening op de Batterij-pagina.
- Behoud de gekozen modus bij opslaan, wijzigen en herstarten; alleen de gebruiker wijzigt de stand van de regelaar.
- Bedien laadkabelvergrendeling ook via switches met on/off-status, met behoud van nulvermogencontrole bij ontgrendelen.
- Toon na kamerdoelwijzigingen of de thermostaatopdracht is verstuurd, bevestigd of geblokkeerd.

## 1.0.1 - 2026-10-13

- Gebruik de gekoppelde laadstatussensor om doorvoer te onderscheiden van laden en ontladen.
- Toon Doorvoer in Energiestromen alleen als alle gekoppelde batterijen doorvoer melden en het netto batterijvermogen nul is.
- Koppel minimum- en maximumniveau-entiteiten rechtstreeks op de Batterij-pagina, per batterij.
- Stel batterijniveaus in via de gekoppelde percentage-entiteiten, met apparaatvrijgave, actieve modus en controle op grenzen en stapgrootte.

## 1.0.0 - 2026-10-13

Eerste stabiele release van Gridnest voor Home Assistant.

- **Energiestromen & Dashboard**:
  - Realtime visualisatie van zonne-opwek, netimport/export, woningverbruik, warmte, laadpaal en thuisbatterij.
  - Dynamische stroomanimaties: geanimeerde stroomlijnen tussen woning, batterij en overige knooppunten op basis van actuele richtingen (laden vs ontladen).
  - Volledige fasemetingen (L1/L2/L3) met gemeten vermogen, spanning, actuele stroomsterkte en visuele ampère-kleurenbalken.
  - Elektrische dagrecap en officiële Home Assistant Energie-integratie.
  - Optionele gas- en waterverbruiksanalyses (24 uur, 7 dagen, 30 dagen).
  - Schakelbare weergave in Watt (W) en kilowatt (kW) met Nederlandse getalnotatie.
  - Handmatig schakelbare donkere en lichte modus.

- **Thuisbatterij & Multi-systeem beheer**:
  - Ondersteuning voor meerdere batterijsystemen (tot maximaal 4) met eigen laadtoestand, vermogen, input/output, resterende tijd en batterijgezondheid.
  - Direct overzicht van alle actieve batterijen op de startpagina met actuele laadstatus en gesommeerd totaal batterijvermogen.
  - Beveiligde handmatige activatie en besturing van gekoppelde accuschakelaars.
  - Dynamische verberging wanneer gekozen is voor "Geen batterij aanwezig".

- **Warmte in huis**:
  - Ruimtes configureren per verdieping met streef- en comforttemperaturen.
  - Directe handmatige temperatuurknoppen (+ / -) op het hoofddashboard om het kamerdoel aan te passen.
  - Ondersteuning voor zowel fysieke temperatuursensoren als klimaat-/thermostaatentiteiten (`climate`).
  - Ondersteuning voor persoons- en aanwezigheidssensoren voor automatische comfort- en afwezigheidstemperaturen.
  - Begrensde zonne-voorverwarming voor airco's bij aanhoudend zonoverschot.

- **Laadpaal & Elektrisch Voertuig (EV)**:
  - Uitlezen van laadvermogen, auto-accupercentage, laadkabelstatus, kabelvergrendeling, sessie-energie en fasestromen.
  - Beveiligde laadpaalbediening voor laden starten/stoppen, kabelvergrendeling en laadstroombegrenzing (6–32 A).
  - Dynamische verberging wanneer gekozen is voor "Geen laadpaal aanwezig".

- **Stroomregels & Automatisering**:
  - Ingebouwde regelbouwer met prioriteiten, voorwaarden en acties voor warmte, laadpalen, zonnepanelen en batterijen.
  - Ondersteuning voor numerieke grenzen, switches, tijdsduren (`voor x minuten`) en tekstcondities (zoals KNMI-weeralarm).
  - Kant-en-klare KNMI-weercoderegel voor het automatisch bijladen en verhogen van de accureserve bij code oranje/rood.
  - Veilige scheiding tussen Uit, Proefmodus en Actieve sturing met Supervisor-apparaatvrijgave.
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