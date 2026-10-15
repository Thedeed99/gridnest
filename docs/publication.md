# Publicatiechecklist

## In de repository aanwezig

- [x] Repositorymetadata in de root.
- [x] Een add-onmap met vereiste metadata en Dockerfile.
- [x] Stabiele slug, versie en naam Gridnest.
- [x] Ingress op poort 8080 zonder open hostpoort.
- [x] Home Assistant API via Supervisor-token; geen token in de browser.
- [x] Standaard AppArmor en beschermde modus; geen host- of beheerdersrechten.
- [x] Persistentie in `/data`, documentatie en changelog.
- [x] Workflow voor tests, browserbuild en amd64/aarch64-containerpublicatie.
- [x] Container-smoke-test voor beide architecturen opgenomen als gate voor publicatie (nog niet uitgevoerd).
- [x] Gescheiden Warmte/Stroom-bediening en standaard-uit live-vrijgave.
- [x] Zonnevoorverwarming met begrensd doel, vermogenscorrectie en wachttijden; lokaal getest met fictieve data.

## Voor een publiek installeerbare release

- [x] Publieke bronrepository onder het persoonlijke account gekozen: https://github.com/Thedeed99/gridnest.
- [x] Copyrightbeleid gekozen: alle rechten voorbehouden; geen licentie voor hergebruik of verdere distributie.
- [ ] Contactpersoon voor publicatie en onderhoud vastleggen.
- [ ] Icon en logo als PNG toevoegen en controleren.
- [ ] Werkelijke installatie, herstart, back-up en herstel testen op Home Assistant OS.
- [ ] Ingressacties, assetpaden en toegangscontrole op een echte Supervisor testen.
- [ ] amd64 en aarch64 containers daadwerkelijk bouwen en smoke-testen.
- [ ] Images publiceren, bereikbaarheid vanuit Home Assistant testen en `image` in `config.yaml` instellen.
- [ ] Bases en GitHub Actions op gecontroleerde digests/commits vastzetten voor releases.
- [ ] Imageondertekening en kwetsbaarheidsscans toevoegen; minimale onderhoudsprocedure vastleggen.
- [ ] Versienummer, changelog en gepubliceerde imagetag gelijk houden.
- [ ] Review via pull request afronden voordat een release wordt gepubliceerd.

## Catalogus versus repository

Een bruikbare eigen repository kan door gebruikers aan de Store worden toegevoegd. Dat is geen automatische toelating tot de officiële of communitycatalogus. De beheerder daarvan beslist volgens diens actuele toelatings- en onderhoudseisen. Gridnest is op dit moment niet aangemeld of goedgekeurd.

## Status van deze voorbereiding

De bronrepository is publiek beschikbaar op https://github.com/Thedeed99/gridnest. De projecteigenaar heeft gekozen voor alle rechten voorbehouden; er is geen licentie voor hergebruik of verdere distributie. De officiële release-image wordt alleen na een expliciete, met de pakketversie overeenkomende `v*`-tag gepubliceerd. Een echte Home Assistant OS-installatie- en hersteltest blijft vereist voor een volledige catalogusaanmelding.

Voor een lokale Home Assistant OS-pilot: pak het bronpakket uit en plaats de inhoud in `/addons/gridnest`, laad de Store opnieuw en installeer de lokale app. Begin met `allow_control: false` en proefmodus. Controleer Ingress, entiteiten, opslag en back-up/herstel. Geef echte sturing pas vrij nadat de installateur of eigenaar de apparaatvoorwaarden heeft gecontroleerd. Zie [pilotprocedure](pilot.md).

## Voor automatische regeling

- [ ] Capabilityprofielen en allowlist van veilige apparaatservices.
- [ ] Geldigheid en actualiteit van sensordata, meetrichting en eenheden controleren.
- [ ] Handmatige override, pauze, watchdog en veilige terugval.
- [ ] Fasebelasting, minimumdraaitijd, startfrequentie en fabrikantgrenzen respecteren.
- [ ] Tapwaterveiligheid en vorstbeveiliging buiten de kostenoptimalisatie houden.
- [ ] Plannen eerst in schaduwmodus testen voordat apparaatsturing kan worden geactiveerd.

Bronnen: [repository](https://developers.home-assistant.io/docs/apps/repository/), [configuratie](https://developers.home-assistant.io/docs/apps/configuration/), [publicatie](https://developers.home-assistant.io/docs/apps/publishing/), [presentatie en beveiliging](https://developers.home-assistant.io/docs/apps/presentation/).