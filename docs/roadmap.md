# Ontwikkelrichting

## 1. Koppelen en observeren

De huidige versie haalt bestaande Home Assistant-entiteiten op, bewaart semantische koppelingen en wensen, en geeft meetwaarden weer. Geen directe afhankelijkheid van eerdere workspace-projecten.

Kamers kunnen per verdieping worden aangemaakt met temperatuur, aanwezigheid, doel en meerdere warmtebronnen. Een bron is een unieke apparaatdefinitie die aan meerdere kamers kan worden gekoppeld. Het overzicht beweegt mee met nieuwe meetwaarden en configuratiewijzigingen.

## V1: Eigen regels

De als/dan/anders-regelbouwer en server-side uitvoerlaag zijn nu aangesloten. Gebruikers bepalen zelf de voorwaarden en acties voor thermostaten, laadpaal, batterij en PV-begrenzing. Proefmodus, bevestigde actuatorcontracten, grenschecks, handmatige pauze en het wachten op apparaatterugmelding zijn aanwezig. Live sturing vereist expliciete appvrijgave en activering; de echte installatie en apparaten zijn nog niet getest.

Deze V1 bevat geen AI, kostenoptimalisator, automatisch verwarmingsrooster of centrale energieallocatie. Warmte kan nu een bevestigd bronapparaat vanuit een gekozen kamerdoel aansturen. Voor airco's is een optionele zonneboost beschikbaar met extra vermogenscorrectie, tijdvenster en wachttijden. Algemene wensen worden niet stilzwijgend stroomregels. Voor V2 kunnen slimme aanbevelingen en eventueel AI worden onderzocht, maar veiligheidsgrenzen en toegestane apparaatopdrachten blijven deterministisch.

## 2. Plan in schaduwmodus

Een lokale planner rekent met toekomstige uur- of kwartierprijzen, zonnevoorspelling, basisverbruik, aanwezigheid en een gekalibreerd warmtemodel. Gebruik een bestaande optimalisatiesolver. Leg tijdsloten met absolute tijdstempels vast, met Nederlandse lokale weergave en tests rond zomer- en wintertijd.

De planner moet laadenergie voor een deadline, minimale comforttemperaturen en netlimieten tegelijkertijd respecteren. Bij een onhaalbaar plan toont Gridnest een expliciete reden en alternatieven. Ontbrekende forecasts mogen niet ongemerkt door demodata worden vervangen. Geen besparingsclaims zonder gemeten vergelijkingsbasis.

## 3. Beperkte, veilige regeling

Begin met een getest apparaatprofiel en expliciete opt-in per apparaat. Meetvermogen, laadstatus, start/stop en stroomlimiet zijn verschillende capabilities. Een `sensor` is nooit een bedieningsentiteit. Comfortregeling kan via geschikte `climate`-services, maar alleen met fabrikantspecifieke minimumdraaitijden, temperatuurgrenzen en een veilige terugval.

### Concrete route voor verwarming

1. **Apparaatmogelijkheden vastleggen.** Lees ondersteunde HVAC-modi, setpointgrenzen en apparaatstatussen uit Home Assistant. Leg per bron fabrikantvoorwaarden, minimumdraaitijd, minimale rusttijd en betrouwbare dataversheid vast. Stel vast welke kamers werkelijk door die bron of zone bediend worden. Een gekoppelde sensor bewijst geen onafhankelijke regelbaarheid.
2. **Kamervraag bepalen.** Combineer comfortrooster, aanwezigheid, handmatige override en een gekalibreerde opwarmtijd. Gebruik bronafhankelijke hysterese in plaats van schakelen op iedere kleine meetwijziging. De huidige 0,3 graden-statusband is slechts weergave en geen gevalideerde regelstrategie.
3. **Bronkeuze en gedeelde vraag oplossen.** Geef bronnen rollen zoals basiswarmte of snelle aanvulling en expliciete prioriteiten. Een trage vloer kan stabiele basiswarmte leveren; een airco kan een geschikte kamer sneller aanvullen. Deel dezelfde `climate`-entiteit niet uit aan meerdere zelfstandige controllers: een centrale arbiter levert maximaal een besluit per bron. Kamerdoelen kunnen conflicteren; zonder afzonderlijke zones zijn ze niet allemaal onafhankelijk realiseerbaar.
4. **In proefmodus evalueren.** Bereken eerst gewenste setpoints en bronkeuze zonder services aan te roepen. Toon per besluit de reden, gebruikte meetgegevens en blokkerende voorwaarden. Vergelijk met werkelijke temperaturen en verbruik in een pilotwoning. Kies niet de zogenaamd goedkoopste bron zonder gas-/stroomtarieven en bruikbare rendementsdata.
5. **Gecontroleerd activeren.** Activeer pas na expliciete toestemming per bron. Voer alleen server-side toegestane, gevalideerde `climate`-opdrachten uit, bijvoorbeeld een begrensd setpoint. Schakel de netvoeding van een warmtepomp of cv-installatie niet als algemene regelstrategie. Controleer daarna de gemelde apparaatstatus; een geslaagde API-aanroep is geen bewijs van geleverde warmte.
6. **Toezicht en veilige terugval.** Voeg pauze, override, auditlog, watchdog, beperkte retries en veilige terugval bij ontbrekende data of communicatie toe. Veilig gedrag bij uitval moet per apparaat worden vastgesteld; blind uitzetten is niet universeel veilig. Vorstbeveiliging, tapwaterveiligheid en fabrieksbeveiligingen hebben voorrang op optimalisatie.

De uitgebreide automatische kamer- en bronregelaar hierboven is nog niet gebouwd of live gevalideerd. De huidige V1 kan wel expliciete gebruikersregels uitvoeren; kamer- en brondefinities alleen geven geen toestemming om apparaten te bedienen.

## 4. Uitbreiden

Warmtepomp, boiler, EV, batterij en flexibele huishoudelijke apparaten krijgen elk hun eigen capabilityprofiel, voorwaarden en tests. Zoninstraling en aanwezigheid worden invoer voor het warmtemodel. Voorspelde ruimteverwarming en tapwater worden afzonderlijk behandeld.

## Nog te bepalen

Pilotwoning, beschikbare entiteiten, tarievenbron, forecastbron, apparaten, comfortgrenzen, faseverdeling en thermische kenmerken. Pas na deze afstemming kan een bruikbare regelaar worden gevalideerd.