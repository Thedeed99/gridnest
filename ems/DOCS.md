# Gridnest gebruiken

## Installatie

Gridnest is bedoeld voor Home Assistant OS met Supervisor. Voeg de publieke repository `https://github.com/Thedeed99/gridnest` toe via de repository-instellingen van de Store. Installeer Gridnest en open de webinterface. De V2.0-release wordt gepubliceerd als versie 2.0.0 nadat de releasechecks zijn geslaagd.

Voor lokaal testen kun je de complete map `ems` als lokale add-on in `/addons/gridnest` plaatsen, de Store opnieuw laden en Gridnest installeren. De Dockerfile bouwt lokaal zolang geen gepubliceerde image is ingesteld.

Home Assistant Container heeft geen add-onwinkel. Daar kan dezelfde container los draaien, met `HA_URL` en `HA_TOKEN` via omgevingsvariabelen. Stel de container alleen beschikbaar op een vertrouwd lokaal netwerk achter passende authenticatie; de losse container heeft geen eigen login. Bind bij voorkeur uitsluitend aan localhost of gebruik een authenticerende reverse proxy.

## Entiteiten

Onder **Koppelingen** vind je een zoekveld en keuzelijsten met bestaande entiteiten. Koppelingen zijn optioneel. Selecteer de passende bron en sla op.

| Rol | Vereiste entiteit |
| --- | --- |
| Netafname | `sensor`, actueel vermogen in W of kW |
| Teruglevering | Afzonderlijke `sensor`, positief actueel vermogen in W of kW |
| Netvermogen | Een `sensor` met positief en negatief vermogen in W of kW |
| Totaal woningverbruik | Optionele `sensor`, actueel woningverbruik inclusief eigen zonnestroom in W of kW |
| Bekend verbruik | Optionele totaalsensor voor de bekende apparaten in W of kW |
| Batterijvermogen | Getekende `sensor` aan de woningzijde van de batterij, in W of kW |
| Zonnepanelen | `sensor`, actueel productievermogen in W of kW |
| Zonneopbrengst vandaag | Optionele `sensor` in Wh/kWh: een dagmeter of een cumulatieve totaalmeter met de juiste bronkeuze |
| Kamertemperatuur | `sensor`, temperatuur in graden Celsius |
| Verwarming | `climate` |
| Laadpaal | `sensor`, actueel laadvermogen in W of kW |
| Thuisbatterij | `sensor`, laadtoestand in % |
| Aanwezigheid | `binary_sensor`, device class `occupancy` of `presence` |

Een cumulatieve kWh-meter is geen vermogenssensor. Onder **Netsensor** kun je kiezen tussen aparte afname/teruglevering of een getekende netsensor. Bij een getekende sensor is positief standaard netafname en negatief export. Voor een omgekeerde meter kun je de tekenrichting wijzigen. Bij ontbrekende meetwaarden toont Gridnest niet beschikbaar, niet nul.

## Totaal, bekend en onbekend verbruik

Netvermogen is niet het woningverbruik. Met 2 kW zonnestroom en -0,5 kW netvermogen (export) verbruikt een woning zonder batterij 1,5 kW, niet -0,5 kW.

Een gekoppelde totaalsensor voor woningverbruik heeft voorrang. Zonder die sensor berekent Gridnest het totaal alleen bij een complete energiebalans:

**Woningverbruik = zon + netafname - teruglevering - batterijladen + batterijontladen.**

Deze balans veronderstelt AC-metingen aan dezelfde woningzijde en omvat batterijverliezen volgens die meetgrens. Een DC-omvormer- of batterijmeting is daarvoor niet zonder correctie bruikbaar. Geef expliciet aan of er geen batterij is of koppel getekend batterijvermogen. Een onbekende batterij of ontbrekende benodigde bron blokkeert de berekening; een ontbrekende zonnesensor wordt niet zomaar nul.

Onder **Bekende verbruikers** kies je een van twee bronnen:

- Afzonderlijke apparaatmetingen: selecteer bijvoorbeeld de laadpaal, warmtepomp en koelkast. Gridnest telt alleen deze geselecteerde sensoren op. Een laadpaal in het stroomschema wordt niet nogmaals automatisch opgeteld.
- Een bestaande totaalsensor: koppel je eigen som van bekende apparaten. Deze wordt niet bij losse apparaatmetingen opgeteld.

Selecteer geen groepmeter samen met de onderliggende apparaten. Gridnest kan een fysieke overlap tussen verschillende sensoren niet automatisch herkennen. Een exact dubbele entiteit en gekoppelde woning-, productie-, net- of batterijmeters als los apparaat worden geweigerd.

Bij geselecteerde bekende apparaten kun je optioneel een aan/uitschakelaar koppelen. Elk apparaat heeft maximaal een unieke `switch`-entiteit. Het verbruikersblok toont een aan/uit-icoon: rood bij een werkelijk uitgeschakelde switch, wit bij ingeschakeld, grijs bij onbekende status. Nul watt betekent niet automatisch uit. Handmatige bediening vraagt bevestiging en apparaatvrijgave, maar niet de stand Actief voor automatische regels. De beschikbare aan/uitstatus wordt eerst opnieuw uit Home Assistant gelezen en moet dezelfde bevestigde stand hebben. Een oude wijzigingstijd van een onveranderde switch is daarbij geen reden voor afwijzing. Uitschakelen kan een lopend apparaatproces onderbreken; koppel alleen geschikte switches. De bediening wijzigt niet automatisch eigen Stroomregels.

Gas en water tonen geen cumulatieve totaalstand meer. Bij iedere grafiek staat de som van het getoonde verbruik over 24 uur, 7 dagen of 30 dagen in m3. Ontbrekende meetpunten maken het totaal onvolledig; zonder bruikbare historie verschijnt niet beschikbaar.

Op het tabblad **Tarieven** stel je stroom, teruglevering, gas en water in. Stroom, teruglevering en gas kunnen een **Vast contract** met handmatige prijzen tot zes decimalen of een **Dynamisch contract** met prijssensor gebruiken. Water gebruikt uitsluitend een vast tarief. Stroomverbruik en teruglevering kunnen ieder één tarief voor laag en hoog delen of aparte lage en hoge prijzen gebruiken. Voor dynamische contracten kies je per dag, uur of 15 minuten. Per tarief kun je maximaal twee toekomstige vaste prijswijzigingen plannen; elke wijziging wordt automatisch actief vanaf middernacht op de gekozen datum in de Home Assistant-tijdzone. De tab **Koppelingen** bevat alleen de bijbehorende verbruiks- en teruglevermeters. Bij één tarief geldt dezelfde prijs voor laag en hoog; bij twee tarieven wordt iedere meter met zijn eigen prijs berekend. Oude totale meterstanden blijven als verborgen terugval behouden.

Het tabblad **Tarieven** toont ook de opgeslagen prijshistorie, gegroepeerd per dag, uur of 15 minuten. Historie wordt lokaal bewaard in `/data/price-history.json` en na 45 dagen opgeschoond. Handmatige tarieven worden direct na opslaan en daarna dagelijks geregistreerd. Dynamische prijzen volgen het ingestelde interval; wijzigingen worden meteen vastgelegd. Historie begint vanaf de eerste registratie en wordt niet terugwerkend aangevuld. Op Overzicht verschijnt bij een dynamisch contract een grafiek voor de komende 24 uur wanneer de prijssensor toekomstige prijzen aanlevert; zonder forecastwaarden wordt geen lijn geschat. Kosten worden berekend met Home Assistant-verbruikstatistieken per uur. Bij kwartierprijzen wordt het uurverbruik naar tijdsduur verdeeld; een exact gemeten verbruik per kwartier is daarmee niet beschikbaar. Ontbrekende meter- of prijshistorie wordt als onvolledig getoond, niet met een schatting op basis van de huidige prijs.

De kaart **Financieel** toont vandaag en deze kalendermaand: kosten per ingeschakelde soort, terugleveropbrengsten en saldo kosten (kosten min opbrengsten; negatief is netto opbrengst). De tarieven zijn inclusief de belastingen en toeslagen die je zelf invult; vaste kosten, saldering en terugleverkosten worden niet afzonderlijk berekend.

Bij een gekoppelde prijssensor bewaart Gridnest de prijs iedere minuut wanneer die verandert, en minstens eenmaal per uur zolang de waarde gelijk blijft. De historie staat in `/data/price-history.json`, blijft bewaard na een herstart en wordt na 45 dagen opgeruimd. Kosten worden per uurstatistiek berekend met de bijbehorende tijdgewogen prijs. Omdat het verbruik alleen per uur beschikbaar is, wordt een prijswijziging binnen dat uur naar tijdsduur verdeeld. Negatieve stroomprijzen zijn toegestaan. Historie begint bij het inschakelen/koppelen en wordt niet achteraf aangevuld; periodes met ontbrekende meter- of prijshistorie worden als onvolledig getoond, niet met het huidige tarief geschat. Een handmatig tarief blijft een vaste prijs voor de hele periode.

Voor gas en water vult Gridnest ontbrekende historievakken aan met de uurwaarden uit Home Assistant-langetermijnstatistieken van de gekoppelde meter. Deze meter moet volumestatistieken met een som hebben; de waarden worden in m3 opgevraagd. Zo kunnen ook oudere dagen zichtbaar blijven nadat de gewone sensorhistorie is opgeschoond. Historie en statistieken worden niet dubbel opgeteld. Zonder beschikbare statistieken blijft gewone historie de terugval; ontbrekende grafiekwaarden worden als 0 getoond. De actuele dagrecap blijft de eigen dagbron gebruiken.

De dagrecap bevat woningverbruik en teruglevering, plus laadpaal en batterij laden/ontladen voor zover die beschikbaar zijn. De bron is bij voorkeur dezelfde Home Assistant Energie-configuratie met recorderstatistieken als de officiele Energie-pagina. De daggrens volgt de Home Assistant-tijdzone. Deze statistieken worden niet continu bijgewerkt; het laatst beschikbare tijdstip wordt getoond. Woningverbruik wordt uit de ingestelde energiestromen berekend, nooit alleen uit netafname. Zonder bruikbare officiele statistieken worden historieschattingen expliciet gemarkeerd. De twee hoofdtotalen blijven zichtbaar als Niet beschikbaar wanneer de benodigde meters ontbreken. Gas en water verschijnen alleen na inschakelen en tonen dezelfde bron of een gemarkeerd alternatief sinds middernacht. Losse verbruikers en fasen staan niet in deze compacte recap.

**Onbekend / niet toegewezen = totaal woningverbruik - bekend verbruik.** Dit is een restberekening, geen herkenning van individuele apparaten. Bij een ontbrekende geselecteerde meting is de uitsplitsing niet compleet. Een bekende som hoger dan het totaal levert een waarschuwing op, geen negatief onbekend verbruik. Niet-gelijktijdige metingen kunnen eveneens een verschil veroorzaken.

Home Assistant ondersteunt koppelingen met veel merken; Gridnest gebruikt die entiteiten, niet eigen fabrikantaccounts. Niet ieder apparaat heeft een veilige bedieningsentiteit. Een koppeling is daarom nog geen bewijs dat het apparaat automatisch kan worden gestuurd.

## Apparaatpagina's

Laadpaal en Accu tonen een centraal apparaatbeeld, bedieningsknoppen en compacte metingen in een paneel dat meegroeit met de pagina. Ontbrekende metingen blijven herkenbaar als niet beschikbaar. De fasebalkjes bij Laadpaal tonen gemeten laadstroom, niet de resterende capaciteit van de aansluiting.

Koppel bij Laadpaal optioneel een laadschakelaar (`switch`), stroomlimiet (`number` in A), kabelslot (`lock`), auto-accupercentage (`sensor` in %) en cumulatieve energiemeter (`sensor` in Wh/kWh met statistieken). De auto-accumeter komt uit de auto-integratie, niet uit de thuisbatterij. Starten vereist een recent aangesloten kabel; de stroomlimiet is begrensd op 6–32 A en het bereik en de stap van de entiteit. Ontgrendelen vereist recent gemeten nulvermogen. Iedere handmatige laadpaalopdracht vraagt bevestiging en apparaatvrijgave, maar niet Actief voor de automatische regelaar. Beschikbare actuatorstatus wordt opnieuw uitgelezen; sensorveroudering blijft strikt gecontroleerd. Actieve regels kunnen handmatige waarden later overschrijven.

Laadpaal en Accu bevatten geen aparte Vandaag-sectie meer; de gezamenlijke dagrecap staat op Overzicht. Een accu-opdracht wordt niet gelijkgesteld aan een bewezen schakeling: na het versturen controleert Gridnest de terugmelding. Blijft de gewenste stand onbevestigd, dan verschijnt een waarschuwing en wordt de opdracht niet automatisch herhaald.

Bij Zonnepanelen staat de actuele dagopbrengst naast de verwachte dagopbrengst. Een gekoppelde **Zonneopbrengst vandaag** heeft voorrang; Wh wordt omgerekend naar kWh. Zonder die koppeling wordt het dagtotaal uit de vermogenshistorie geschat en blijft onvolledige historie gemarkeerd. Een gekoppelde maar ongeldige dagmeter wordt niet stil vervangen door een schatting. De uurgrafiek gebruikt vermogenshistorie en kan daardoor afwijken van de aparte dagmeter. De productielimietslider wordt bij loslaten toegepast na toestemming voor de huidige browsersessie en gekoppelde entiteit. Na herladen of een mislukte opdracht is opnieuw toestemming nodig. Vrijgave, Actief en recente geldige telemetrie blijven verplicht.

Voor een allertijdenmeter zoals `sensor.solaredge_i1_ac_energy`: kies onder **Koppelingen** bij **Bron zonneopbrengst vandaag** de optie **Cumulatieve totaalmeter** en koppel die sensor aan **Zonneopbrengst vandaag**. Gridnest leest alleen Home Assistant en berekent het verschil tussen de stand bij middernacht in de Home Assistant-tijdzone en de actuele stand. De meter moet Wh/kWh en state_class total of total_increasing gebruiken. Zonder bewaarde beginstand, bij ongeldige standen of een tellerreset blijft het dagtotaal Niet beschikbaar; het levensduurtotaal wordt nooit als vandaag getoond. De uurgrafiek blijft afhankelijk van vermogenshistorie.

## Mijn wensen

Onder **Metingen verversen** kies je 5, 10, 30 of 60 seconden, of alleen handmatig. De standaard is 10 seconden. Sla de wensen op om het interval te bewaren. De vernieuwknop blijft beschikbaar; het gekozen interval geldt voor het ophalen van metingen, niet voor de regelcyclus. Automatisch verversen wacht bij een verborgen pagina, open dialoog of actieve slider.

Stel comforttemperatuur, afwezigtemperatuur, dagelijkse aanwezigheid, maximaal netvermogen, gewenste laadenergie en een laadtermijn in. Aanwezig vanaf/tot wordt opgeslagen, maar de huidige warmteregelaar gebruikt deze tijden niet als rooster of als fallback bij ontbrekende personen. Nieuwe kamers beginnen op de comforttemperatuur; de afwezigtemperatuur kan via de optionele kamerregeling op basis van sensoren/personen worden toegepast. Maximaal netvermogen, gewenste laadenergie, laadtermijn en voorkeur voor zonnestroom maken momenteel geen automatisch laadplan en sturen niet zelfstandig de laadpaal. Daarvoor zijn handmatige bediening of eigen Stroomregels nodig. Een kW-limiet is geen vervanging voor beveiliging van afzonderlijke fasen.

### Meerdere personen

Onder **Aanwezigheid huishouden** selecteer je personen (`person`), apparaatvolgers (`device_tracker`) of aanwezigheidssensoren uit Home Assistant. Je kunt op naam of entiteit-ID zoeken. Selecteer bij voorkeur een bron per persoon, niet zowel de persoon als diens telefoon.

Standaard geldt **Minstens een persoon thuis**: een bekende aanwezige persoon is voldoende; afwezig geldt pas als alle geselecteerde bronnen bekend afwezig zijn. Een verdwenen, onbeschikbare of onbekende bron telt niet als afwezig. De optionele keuze **Iedereen thuis** vereist dat alle geselecteerde personen thuis zijn; iemand die aantoonbaar weg is maakt die voorwaarde onwaar, ook als een ander nog thuis is.

Schakel per kamer **Afwezigtemperatuur toepassen bij afwezigheid** in om aanwezigheid ook voor sturing te gebruiken. Een expliciete kamersensor heeft voorrang; zonder kamersensor gebruikt Gridnest de huishoudelijke personenkeuze. Bij afwezigheid geldt de laagste van kamerdoel en afwezigtemperatuur, zonder zonneboost. Bij aanwezigheid geldt weer het vaste kamerdoel. De afwezigheidsoptie staat standaard uit.

De Aanwezig/Afwezig-badge op een kamer verschijnt uitsluitend als die kamer een eigen aanwezigheidssensor heeft en de status bekend is. Huishoudelijke aanwezigheid wordt niet als gemeten kameraanwezigheid getoond; de optionele regeling kan die huishoudelijke aanwezigheid wel blijven gebruiken.

Voor sturing moeten de aanwezigheidssignalen recent zijn volgens de ingestelde maximale meetouderdom. Bij onzekere of te oude aanwezigheid wordt de betrokken bronregeling geblokkeerd, niet automatisch verlaagd. De overzichtsbadge toont de laatst bekende beschikbare status; de controle voor sturing is strenger. Wijzigingen van personen, any/all-keuze of afwezigtemperatuur behouden de gekozen modus. De thermostaat behoudt zijn laatst ingestelde doel totdat een volgende toegestane opdracht volgt.

Onder **Verwarmingsprofiel** kun je vloerverwarming, airco/lucht-luchtwarmtepomp of radiatoren/convectoren kiezen. Het profiel geeft algemeen advies; er worden geen temperaturen of schakelcommando's automatisch toegepast. Een zware vloer is vaak gebaat bij een stabiele temperatuur en beperkte verlaging. Een airco kan de bediende ruimte vaak snel verwarmen. Installatie, isolatie en buitentemperatuur bepalen of dit advies past.

## Warmte in huis

Het algemene **Overzicht** bevat een compacte warmtesamenvatting met kamers op verdiepingsvolgorde, gemeten temperaturen, vaste kamerdoelen, aanwezigheid en bronstatussen. Een eventueel hoger zonnedoel wordt apart getoond. De samenvatting gebruikt dezelfde gegevens en kamerweergave als Warmte, ververst automatisch en heeft een doorklik per kamer. Instellingen en verwarmingsadvies staan niet in deze samenvatting.

Het scherm **Warmte** toont zelf aangemaakte kamers per verdieping. Gebruik de plusknop voor een kamer, of de plusknop bij een verdieping om daar een kamer toe te voegen. De verdiepingdropdown bevat Kelder, Begane grond, 1e verdieping, 2e verdieping en Zolder. Bestaande afwijkende verdiepingsnamen blijven beschikbaar zodat opgeslagen kamers behouden blijven. Dezelfde verdieping groepeert kamers samen.

Een kamer heeft een naam, verdieping, optionele temperatuursensor, optionele aanwezigheidssensor, gewenste temperatuur en nul of meer warmtebronnen. Het startdoel van een nieuwe kamer komt uit je algemene comfortwens. Daarna is het doel per kamer opgeslagen; algemene wijzigingen overschrijven bestaande kamerdoelen niet.

Maak onder **Warmtebronnen** bijvoorbeeld een cv-bron en een airco aan. Elke bron heeft een naam, een optionele `climate`-entiteit en een eigen verwarmingsprofiel. Profieladvies staat in de instellingen en brondialoog, niet op het energieoverzicht. Dezelfde bron kan aan meerdere kamers worden gekoppeld; dezelfde bedieningsentiteit wordt niet dubbel als bron vastgelegd.

Gemeten temperaturen en bronstatussen worden iedere 30 seconden vernieuwd. Open bewerkdialogen blijven tijdens verversen intact. Een kamer toont onder doel, op temperatuur of boven doel met een indicatieve band van 0,3 graden rond het vaste kamerdoel. Deze statusband is alleen weergave; de eigen apparaatthermostaat regelt de warmtelevering. Aanwezigheid verandert het effectieve doel uitsluitend als de afwezigheidsoptie voor de kamer aanstaat. Bij ontbrekende sensoren verschijnt geen verzonnen temperatuur.

Waar beschikbaar wordt de werkelijke `hvac_action` getoond, bijvoorbeeld verwarmen of stand-by. Zonder die informatie toont Gridnest alleen de ingestelde modus. Een apparaat in verwarmmodus hoeft niet daadwerkelijk warmte te produceren.

Kamers en bronnen zijn via het potlood te bewerken. Verwijderen vereist bevestiging. Bij het verwijderen van een bron worden de kamerreferenties naar die bron ook verwijderd; andere bronnen blijven gekoppeld.

Warmte kan nu zelf thermostaatdoelen en verwarmmodus aansturen. Kies bij een bron een gekoppelde regelkamer, zet bronregeling aan en bevestig de thermostaatbediening. Het kamerdoel wordt dan de doeltemperatuur van die bron. Het temperatuurdoel wordt eerst geschreven; verwarmmodus volgt pas na terugmelding. De eigen thermostaat regelt vervolgens de warmteafgifte. Gridnest schakelt de netvoeding niet uit.

Warmte heeft een eigen stand Uit, Proefmodus of Actief, onafhankelijk van Stroom. Gebruik eerst proefmodus; een nieuwe activering vereist dezelfde appvrijgave en expliciete bevestiging als Stroom. De gekozen stand blijft behouden bij opslaan en herstarten. De pauzeknop in Warmte stopt nieuwe warmteopdrachten, niet de stroomregels. Dubbele thermostaatbediening vanuit Warmte en een bestaande stroomregel wordt geblokkeerd.

Een gedeelde centrale thermostaat maakt kamers niet onafhankelijk regelbaar: daarvoor zijn geschikte zoneregeling of radiatorregelaars nodig. Per bron is daarom een regelkamer leidend; andere kamers worden gemonitord. Meerdere ingeschakelde bronnen op dezelfde kamer krijgen hetzelfde doel, zonder automatische keuze van de goedkoopste bron. Een airco heeft alleen invloed op de ruimtes die deze fysiek kan verwarmen.

### Voorverwarmen met zonnestroom

Bij het airco-profiel kun je voorverwarmen met zonnestroom inschakelen. Koppel het eigen elektrische aircovermogen in W of kW. De normale kamertemperatuur blijft het basisdoel; de zonneboost is optioneel, standaard 1 graad en maximaal 2 graden extra, altijd binnen het apparaatbereik en maximaal 26 graden.

Bij een kamerdoel van 21 graden en een boost van 1 graad berekent Gridnest een absoluut thermostaatdoel van 22 graden. Het kamerdoel zelf blijft 21. Na het wegvallen van de boost gaat het thermostaatdoel terug naar 21. De app telt niet elke regelcyclus een graad op bij de actuele apparaatinstelling: 22 wordt dus niet vanzelf 23, 24 of hoger. De opdracht wordt via `climate.set_temperature` verstuurd en de app wacht op terugmelding; in proefmodus wordt alleen de voorgenomen opdracht getoond.

Instelbaar zijn startoverschot, een lagere stopdrempel, start- en stopwachttijd en een dagelijkse zonneperiode. De regeling vereist recente zonneproductie, netafname/teruglevering en aircovermogen. Bij een batterij moet de batterijsituatie bekend zijn en mag deze niet aan het ontladen zijn. Ontbrekende zonne-invoer schakelt de boost uit en geeft het normale comfortdoel; ontbrekende kamer- of apparaatdata blokkeren de opdracht.

Tijdens een boost telt Gridnest alleen het extra aircovermogen boven de meting bij de start terug bij het overschot. Dit beperkt heen-en-weer schakelen doordat de airco zelf teruglevering vermindert. Buiten de zonneperiode keert het doel direct terug naar comfort. Bij een werkelijk tekort geldt de ingestelde stopwachttijd. De airco wordt niet blind uitgezet.

In V1 krijgt maximaal een airco tegelijk zonneboost toegewezen. Bronprioriteit bepaalt bij de start de volgorde; een lopende boost wordt niet voortdurend omgewisseld. Een laadpaal of batterij die energie opneemt vermindert het beschikbare netoverschot. Dit is nog geen centrale optimalisatie van alle apparaten. Test de thresholds en vermogensmeting in een pilot; de software is geen vervanging voor installatieveiligheid.

De uitwerking van toekomstige automatische bronkeuze staat in [de ontwikkelrichting](../docs/roadmap.md).

## Eigen regels in V1

Onder **Stroom** maak je via de plusknop een stroomregel met een naam, een of meer voorwaarden en een actie voor laadpaal, thuisbatterij of zonnepanelen. Nieuwe verwarmingsacties worden hier niet aangeboden. Eventuele bestaande verwarmingsregels blijven behouden en bewerkbaar voor compatibiliteit. Alle voorwaarden moeten kloppen. Je kiest een sensor, vergelijking en waarde in de eenheid van die sensor. Een binary_sensor gebruikt aan/uit. Sensorwaarden worden niet impliciet tussen W, kW en kWh omgerekend voor voorwaarden.

### Prioriteiten

Elke regel heeft een prioriteit van 1 tot 100: 1 is het hoogst, 100 het laagst. Bestaande en nieuwe regels krijgen standaard 50. Opgeslagen regels en de beoordeling worden van hoog naar laag gerangschikt. Bij gelijke prioriteit blijft de opgeslagen volgorde gelden.

Prioriteit bepaalt de volgorde van beoordelen en verzenden, niet een automatisch energiebudget. Je kunt bijvoorbeeld batterijregels prioriteit 10 geven en laadpaalregels 20, maar Gridnest verdeelt daardoor niet vanzelf het beschikbare zonvermogen tussen die apparaten. De regelvoorwaarden en doelwaarden blijven jouw eigen keuzes. Tegenstrijdige regels voor dezelfde bedieningswaarde blijven geweigerd, ook bij verschillende prioriteiten. Apparaatgrenzen, bevestiging, handmatige pauze en minimale opdrachttijd blijven gelden.

### Entiteiten kiezen

De lijsten voor **Meting** en **Bediening** komen uit je eigen Home Assistant. Zoek op vriendelijke naam of entiteit-ID. Elke optie toont naam, ID, eenheid waar van toepassing en beschikbaarheid. Zo kun je gelijknamige entiteiten onderscheiden. Een geselecteerde entiteit blijft behouden tijdens zoeken; een verdwenen entiteit wordt zichtbaar gemarkeerd en niet stil vervangen.

Voor voorwaarden worden sensor- en binary_sensor-entiteiten getoond. Voor acties worden passende climate-, switch- of number-entiteiten gefilterd; numerieke bediening wordt ook op de vereiste eenheid gefilterd. Ontbrekende capabilities kunnen alsnog een uitvoering blokkeren. In de lokale demoversie zijn dit uitsluitend voorbeeldentiteiten. Bij een echte Home Assistant-app gebruikt Gridnest automatisch de Supervisor-verbinding; er is geen handmatig ingevoerde entiteitslijst nodig.

Kies daarna een passende bedieningsentiteit en de **Dan**- en **Anders**-waarden. Een meetsensor is geen actuator. Schakel de regel in en bevestig dat de geselecteerde entiteit daadwerkelijk de genoemde functie bedient. Gebruik geen netvoedingsschakelaar van een warmtepomp, cv-ketel of omvormer als vervanging voor een echte apparaatbediening.

| Actie | Vereiste bediening |
| --- | --- |
| Verwarming: temperatuurdoel | `climate`, Celsius, bevestigd setpointbereik en stapgrootte |
| Verwarming: verwarmmodus | `climate`, ondersteunt heat/off |
| Laadpaal: laden toestaan | `switch` voor laadtoestemming, niet de netvoeding |
| Laadpaal: stroomlimiet | `number` in A, passend bij het apparaat en de installatie |
| Thuisbatterij: vermogensdoel | Bidirectionele `number` in W of kW plus gekoppelde laadtoestand |
| Zonnepanelen: productielimiet | `number` in %, 0-100% met 100% als volledige productie |

Bij batterijregels geef je de Dan/Anders-waarden altijd in W op: positief is gewenst laden en negatief gewenst ontladen. Gridnest vertaalt dit naar de geselecteerde apparaateenheid en tekenrichting. Op of onder de reserve wordt gewenst ontladen vervangen door nul; op of boven de maximale SoC wordt gewenst laden vervangen door nul. Dit is een softwarebegrenzing, geen vervanging voor het BMS of een gegarandeerde noodstop.

Een voorbeeld voor een getekende netsensor in W, positief netafname en negatief export: **als netvermogen kleiner dan -1500 W, dan laden toestaan, anders laden stoppen**. Dat is een eigen drempelregel, geen volwaardige zonnelaadoptimalisator. Zodra de auto laadt kan het gemeten overschot dalen en de regel opnieuw omslaan. Test de drempels en minimale opdrachttijd; automatische allocatie, fasebewaking en echte hysterese zijn nog geen onderdeel van deze V1-regelbouwer.

Voor verwarming kun je bijvoorbeeld een kamer- of aanwezigheidssensor gebruiken en een begrensd thermostaatdoel instellen. De globale comfortwensen en kamerdoelen worden niet automatisch toegevoegd aan regels. Er is geen automatisch berekend rooster, bronprioriteit of AI-besluit; je bepaalt de logica zelf. Dit kan later in V2 worden uitgebreid.

## Proefmodus en activeren

1. Maak regels en controleer de bediening, meetrichting, eenheden en fabrikantgrenzen.
2. Gebruik **Proefmodus**. De regelcyclus beoordeelt iedere 30 seconden; **Regels nu beoordelen** voert direct een cyclus uit. In proefmodus gaat geen opdracht naar apparaten.
3. Bekijk de regelbeoordeling en los blokkeringen op. Ontbrekende of verouderde voorwaarden leiden niet tot uitvoering van de anders-actie.
4. Voor een echte Home Assistant-app: geef **Echte apparaatsturing vrijgeven** vrij in de appconfiguratie (`allow_control`, standaard uit). Een herstart van de app kan daarvoor nodig zijn.
5. Selecteer **Actief**, sla op en bevestig de activering in Gridnest. In demo of een losse container is actieve sturing geblokkeerd.
6. Bewaak de eerste echte opdrachten in een pilot. **Alle regels pauzeren** zet de regelaar uit; dit stopt nieuwe opdrachten, maar herstelt geen eerdere apparaatwaarden en kan een reeds verzonden opdracht niet terughalen.

Regels wijzigen, aan/uitzetten of verwijderen behoudt de gekozen modus. Na een appherstart blijft Actief behouden en kan de regeling automatisch hervatten zodra apparaatvrijgave en geldige meetgegevens beschikbaar zijn. Kies zelf Uit of Proefmodus wanneer hervatten niet gewenst is. Deze wijziging is niet met fysieke apparaten getest.

## Uitvoering en grenzen

De uitvoerlaag verstuurt alleen opgeslagen, gevalideerde acties via de server. Een regel mag niet dezelfde bedieningswaarde als een andere ingeschakelde regel aansturen. Er gaat maximaal een opdracht per entiteit per cyclus uit, met maximaal vier opdrachten in totaal. Meetwaarden en instellingen worden voor verzending opnieuw gecontroleerd.

Onder **Grenzen en timing** staan maximale meetouderdom, minimale tijd tussen opdrachten, de pauzeduur na een handmatige wijziging en batterij-SoC-grenzen. De minimale opdrachttijd is niet automatisch een fabrikantprofiel; kies deze conservatief en houd rekening met minimumdraaitijden. Constante sensoren zonder recente `last_reported` kunnen worden geblokkeerd, ook als Home Assistant ze nog toont.

Na verzending wacht Gridnest op de gerapporteerde bedieningswaarde. Een onzekere transportuitkomst of ontbrekende bevestiging wordt binnen dezelfde serversessie niet automatisch opnieuw geprobeerd. De regel wordt gepauzeerd totdat je de regelaar uitzet, het apparaat controleert en opnieuw activeert. Een handmatige of externe waardeaanpassing veroorzaakt een tijdelijke pauze. Pauzegegevens worden niet over een appherstart bewaard, terwijl de gekozen modus wel behouden blijft. Zet bij een onzekere opdracht daarom zelf de modus Uit voordat je herstart.

De actuele regelbeoordeling is geen duurzaam auditlog. Het kostenoverzicht is een verbruiksraming, geen volledige factuurberekening of automatische kostenoptimalisatie. Gridnest bewaakt nog geen fasebelasting, fabrikant-specifieke veiligheid of interacties tussen onafhankelijke regels op verschillende apparaten. Laat alle fysieke en fabrieksbeveiligingen ingeschakeld.

## Betrouwbaarheid en opslag

Metingen worden iedere 30 seconden opgehaald. Ontbrekende of onbeschikbare waarden worden als niet beschikbaar getoond. Het ophaaltijdstip is niet het moment van de laatste wijziging van een sensor; een constante waarde kan lang ongewijzigd blijven. Deze monitor bepaalt daarom niet of een sensor technisch nog actief is. Voor automatische sturing zijn freshness-contracten per apparaat nodig.

Koppelingen en wensen worden in `/data/settings.json` bewaard en meegenomen in add-onback-ups. De prijshistorie staat apart in `/data/price-history.json` en valt onder dezelfde persistente data-directory. Demokoppelingen worden niet overgenomen bij omschakeling naar echte Home Assistant-data. Ongeldige opslag wordt niet automatisch overschreven.

## Beveiliging

Ingress verzorgt de toegang via Home Assistant. De server accepteert in add-onmodus alleen de Supervisor-ingressproxy. Er worden geen hostpoorten, hostnetwerk, privileged rechten of Docker-API gevraagd. De applicatie draait na initialisatie van de opslag als niet-rootgebruiker. De standaard AppArmor-bescherming blijft ingeschakeld; een custom profiel is nog niet live gevalideerd.

De server gebruikt het Supervisor-token voor het ophalen van `/states` en de temperatuureenheid uit `/config`, en na expliciete vrijgave voor uitsluitend toegestane climate-, number- en switch-opdrachten. Sleutels en willekeurige entiteitsattributen worden niet naar de browser doorgestuurd. Er bestaat geen publiek endpoint waarmee de browser willekeurige Home Assistant-services kan uitvoeren.

## Problemen

- Geen entiteiten: controleer de Home Assistant-verbinding en toegangsrechten.
- Entiteit ontbreekt: controleer domein, eenheid en device class.
- Koppeling verdwenen: controleer of de entiteit hernoemd is; koppel deze opnieuw.
- Instellingen niet opgeslagen: controleer de add-onlog en schrijfrechten op `/data`.

Gridnest is experimenteel. Gebruik het niet als veiligheidsvoorziening voor netbelasting, vorstbeveiliging, tapwaterveiligheid of batterijen.