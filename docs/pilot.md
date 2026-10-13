# Gridnest pilot

Dit is een experimentele broninstallatie, geen Store-goedkeuring of gevalideerde productierelease. Docker is lokaal niet beschikbaar, dus deze installatieprocedure is nog niet op Home Assistant OS uitgevoerd.

## Voorbereiden

1. Gebruik een test- of pilotwoning met Home Assistant OS en maak een back-up.
2. Pak het Gridnest-bronpakket uit in de lokale add-onmap `/addons/gridnest`. In die map moeten onder meer `config.yaml`, `Dockerfile`, `package.json`, `src/`, `web/` en `public/index.html` staan.
3. Laad de Store opnieuw, installeer Gridnest als lokale app en open via Ingress.
4. Laat de appoptie voor echte sturing uit. Koppel echte metingen en bedieningsentiteiten; er mag geen demodata actief zijn.

## Controleren zonder opdrachten

- Sla kamers, warmtebronnen en stroomregels op en herstart de app. Controleer dat deze behouden blijven.
- Maak een Home Assistant-back-up, herstel deze in een testomgeving en controleer de instellingen.
- Zet Warmte en/of Stroom op Proefmodus. Geen opdrachten mogen op apparaten verschijnen.
- Controleer dat het algemene dashboard dezelfde kamers, gemeten temperaturen en kamerdoelen toont als Warmte. Test de doorklik en eventuele zonnedoelweergave.
- Kies voor een warmtebron een gekoppelde regelkamer en passende climate-entiteit. Controleer de berekende setpoints, apparaatgrenzen en Celsius-eenheid.
- Test een airco-zonneboost met betrouwbare eigen vermogensmeting, PV-meting en correct getekend netvermogen. Controleer normaal comfortdoel, startvertraging, verhoogd zonnedoel, stopvertraging en terugkeer buiten het tijdvenster.
- Test sensoruitval, een onbekende batterij, ontladende batterij en ontbrekende apparaatcapabilities. De boost mag niet doorgaan op verzonnen nulmetingen.
- Controleer dat een dubbele thermostaatregel vanuit Stroom wordt geblokkeerd en dat handmatige wijzigingen worden gerespecteerd.

## Beperkt activeren

Geef de appoptie voor echte sturing alleen vrij na controle van apparaatvoorwaarden, fabrikantveiligheden, minimumdraaitijden en de werking van elke geselecteerde entiteit. Activeer in Gridnest een enkele bron of regel en bevestig de activering. Observeer het echte apparaat, niet alleen de API-response.

Controleer temperatuurdoel-terugmelding voordat verwarmmodus wordt ingeschakeld. Test pauze en communicatiefouten. Na appherstart blijft de gekozen modus behouden; Actief kan automatisch hervatten zodra apparaatvrijgave en geldige meetgegevens beschikbaar zijn. Kies zelf Uit of Proefmodus als hervatten niet gewenst is. Pauze herstelt niet automatisch eerdere apparaatwaarden; laat de eigen thermostaat en fabrieksbeveiligingen actief.

## Releasebesluit

Pas na geslaagde installatie-, back-up-, veiligheids- en apparaattests komen een publieke repository/image, licentie, contactpersoon en release aan bod. CI moet de amd64- en arm64-images daadwerkelijk bouwen en starten. Een eigen repository toevoegen aan de Store is iets anders dan toelating tot een beheerde catalogus.