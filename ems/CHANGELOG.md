# Changelog

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