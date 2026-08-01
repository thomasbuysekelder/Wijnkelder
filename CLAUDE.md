# CLAUDE.md — werkafspraken voor dit project

Dit is een wijnkelder-PWA voor een niet-technische eigenaar (Thomas).
Interface en alle teksten zijn in informeel Vlaams Nederlands.

## Kernregels
1. `app.jsx` is de enige bron van waarheid. `app.js` is een build-artefact:
   na elke wijziging `npm run bundle` draaien en beide committen (samen met `sw.js` als het cachenummer wijzigt).
2. Verhoog bij elke release het cachenummer in `sw.js` (`kelder-vN`).
3. Hernoem NOOIT de localStorage-sleutels `wijnkelder-flessen-v1` en
   `wijnkelder-scale` — dat wist de kelder van alle gebruikers.
4. Gebruik NOOIT window.confirm/alert/prompt — die zijn geblokkeerd in
   iOS-webapps. Gebruik het bestaande ConfirmModal-patroon.
5. AI-aanroepen gaan via `callClaude()` → `/api/claude` (Vercel-proxy met
   ANTHROPIC_API_KEY). Nooit een sleutel in client-code zetten.
6. Foto's worden client-side verkleind naar JPEG (max 1600px) vóór verzending
   (iPhone HEIC + 4,5MB request-limiet van Vercel). Behoud dit.
7. Invoervelden minimaal 16px font-size (anders zoomt iOS in).
8. De app moet blijven werken zonder ingelogde accounts: data is lokaal
   per toestel; backup/herstel via tekst is het verhuismechanisme.

## Testen
Er is geen testframework in de repo; test minstens: `npm run bundle` slaagt,
en render-check de gewijzigde componenten. Wees extra voorzichtig met de
opslag- en import/export-logica.

## Deploy
Alles staat in de hoofdmap van de repo. Er is geen buildstap op Vercel: pushen naar
`main` deployt de bestanden zoals ze zijn. Bouw dus altijd lokaal vóór het committen.
`vercel.json` bevat enkel `regions: ["fra1"]` — de serverfuncties MOETEN in Europa
draaien, want Vivino geeft een Amerikaans IP een andere (lege) catalogus terug en
DuckDuckGo blokkeert Amerikaanse datacenter-IP's harder. Zet daar geen
build-instellingen in bij, tenzij je weet wat er in het Vercel-dashboard staat.

## Prijsbepaling
- NOOIT een prijs gokken. Het model mag geen prijs uit eigen kennis geven: niet
  bij foto-analyse (`analyzePhoto` vraagt geen prijs meer), niet bij zoeken op
  naam, niet bij `lookupWineFull`. Vindt de opzoeking geen echte prijs, dan blijft
  de retailwaarde LEEG en staat er "geen prijs gevonden" in `priceNote`.
- Volgorde in `applyMarketPrice()`: (1) Vivino-marktprijs voor exact deze
  jaargang, (2) Vivino-marktprijs van naburige jaargangen ("ter indicatie"),
  (3) een bedrag dat het model LETTERLIJK uit de zoeksnippets haalt, mét bron
  (`priceSource`; zonder bron telt het niet), (4) niets → leeg.
- Kies je een andere wijn, dan wist `wisWijnGegevens()` ALLES wat over de vorige
  wijn ging: druif, beschrijving, recensies, score, drinkvenster, coördinaten,
  etiketfoto en de opgezochte prijs. Wat van de gebruiker zelf komt (aantal,
  aankoopprijs, leverancier, locatie, proefnotities) blijft staan. Zonder dat bleef
  bijvoorbeeld de druif van Tenuta di Trinoro op een Contrada Guardiola staan,
  want een opzoeking overschrijft een al ingevuld veld nooit.
- Kan de app het niet zeker weten, dan LAAT ZE KIEZEN. `KiesWijnModal` toont de
  wijnen die de catalogus teruggaf (naam, producent, streek, jaargangen, etiket) en
  de gebruiker duidt de juiste aan. Bereikbaar via "Zoek de juiste wijn op" in het
  bewerkvenster en "Niet juist? Kies de wijn zelf" in het fotovenster. Wat gekozen
  is, overschrijft de etiketlezing en stuurt daarna pas de opzoeking.
- IS DIT WEL DEZELFDE WIJN? Dat is de belangrijkste vraag van de hele app.
  `vivinoKeuze()` neemt niet "alles boven een drempel", maar de groep aanbiedingen
  met de MINSTE vreemde woorden (`vreemdeWoorden()`), en enkel als mijn eigen naam
  erin zit (`naamKlopt()`). Zo wint "Chambertin Grand Cru" van "Chambertin Clos de
  Bèze Grand Cru", terwijl "Case Basse Sangiovese Toscana" gewoon blijft staan.
  Prijs, etiketfoto, streek én Vivino-score komen ALTIJD uit diezelfde keuze —
  nooit uit verschillende aanbiedingen.
- Bij een winkelresultaat moet de TITEL vrij zijn van vreemde woorden. Anders
  belandde de prijs van een Gevrey-Chambertin (€422) op een Chambertin Grand Cru.
- `ALGEMEEN` bevat woorden die niets over de identiteit zeggen (grand, cru,
  classico, domaine, château…). Vul die lijst aan als er valse verschillen
  opduiken; verwijder er nooit iets uit zonder de Chambertin-test opnieuw te doen.
- `/api/search` haalt naast de DuckDuckGo-snippets ook Vivino-aanbiedingen op
  (EUR, markt BE, per jaargang); `marketPrice()` in `app.jsx` kiest de exacte
  jaargang, anders naburige jaargangen, en negeert andere flesformaten.
- Vivino is een NIET-OFFICIËLE bron (ongedocumenteerd endpoint) en wordt hier
  enkel voor persoonlijk gebruik aangesproken. Bij commercialisering van deze app
  moet die bron vervangen worden door een officiële databron met licentie.
- Vivino is een extra bovenop de snippets, geen vereiste: valt de bron weg of
  geeft ze niets terug, dan blijven de snippets werken en blijft de prijs anders
  gewoon leeg.
- De waarschuwing "let op: Vivino noemt deze wijn X" verschijnt ENKEL wanneer de
  gevonden naam mijn hele naam bevat én er woorden bij heeft ("Chambertin Clos de
  Beze" bij een "Chambertin"). Noemt de bron de wijn gewoon anders — een
  Haut-Brion heet bij Vivino "Pessac-Leognan" — dan is er niets aan de hand en
  zwijgt de app.
- Waar de prijs op steunt, staat altijd in `priceNote` en is zichtbaar op de
  detailkaart. Een nieuwe opzoeking mag de prijs van een vorige opzoeking
  overschrijven (anders kan je een foute prijs nooit corrigeren), maar NOOIT een
  zelf ingetikte waarde: die krijgt `priceManual: true` via `fieldPatch()`.
  `ownValue` en `purchasePrice` blijven sowieso onaangeroerd.
- Bij elke gevonden prijs hoort een bron-URL in `priceUrl`, zichtbaar als een
  klein linkje "bron" op de detailkaart. Die URL komt ALTIJD uit onze eigen lijst
  (het Vivino-aanbod, of het zoekresultaat waarnaar het model met
  `priceSourceIndex` verwijst) — nooit uit tekst van het model, zodat ze niet
  verzonnen kan zijn. Geen bron gevonden = geen link.
- De Vivino-link is ALTIJD de zoekpagina:
  `https://www.vivino.com/search/wines?q=<producent + wijn + jaargang>`.
  Bouw NOOIT een link met een Vivino-id of -slug (`/wines/<id>`, `/w/<id>`,
  `seo_name`): die paden komen op de verkeerde wijn uit.
- DuckDuckGo beantwoordt GET-verzoeken vanaf een server met een lege pagina
  (HTTP 202). `/api/search` moet dus met POST zoeken. Elke link zit verpakt in een
  redirect (`/l/?uddg=…`); `realUrl()` pakt die uit tot de echte bron-URL.

## Etiketten lezen
- Een rechtsvorm is GEEN producentnaam ("Azienda Agricola", "Domaine", "Tenuta"…)
  en een jaartal is GEEN wijnnaam. De prompt zegt dat, en `schoonEtiket()` haalt
  eruit wat er toch doorglipt. Die functie loopt over ALLE etiketlezingen, zowel
  van een foto als van het zoeken op naam.

## Bediening
- Naast een venster of naast het menu tikken sluit het. Op iOS bereikt een tik
  alleen betrouwbaar iets dat er klikbaar uitziet, dus luisteren `Overlay` en de
  menu-achtergrond op pointerdown ÉN op click, met `cursor: pointer` erop.
- Maak NOOIT een component binnen een andere component (`const Iets = () => …` in
  een render). React gooit het invoerveld dan bij elke toetsaanslag weg en je kan
  maar één letter tegelijk typen. `ZoekRij` staat daarom op modulehoogte.

## Vensters en het toetsenbord
- iOS verkleint het zichtbare scherm wanneer het toetsenbord opengaat, maar `100vh`
  blijft even groot: de kop schoof weg en de knoppenbalk verdween onder de toetsen.
  `useZichtbareHoogte()` meet `window.visualViewport` en zet `--vvh` en `--vvtop`.
  Meet je een venster in `vh`, dan doe je het fout — gebruik `var(--vvh)`.
- Een venster hangt aan de BOVENKANT van dat zichtbare scherm, dus daar begint ook
  de statusbalk. `Overlay` houdt `env(safe-area-inset-top)` vrij; zonder dat loopt
  de titel onder de klok en de notch.

## Opmaak van het startscherm
- De bedragen staan ALTIJD dicht bij het openen van de app. Dat wordt bewust niet
  onthouden: je moet ze zelf openvouwen, zodat er niets op je scherm staat wanneer
  je de kelder aan iemand toont.
- Boven het cijferblok staat één regel "N flessen · M wijnen" met rechts de knop om
  bedragen te verbergen. Zet daar nooit een opschrift naast dat kan afbreken.
- De bedragen staan in gelijke vakjes op een raster (`S.ledger` + `S.stat`), met
  dezelfde rand en hoeken als de blokken op de detailkaart.
- Het zoekveld neemt de volle breedte; de keuzelijsten eronder delen de rest
  (`S.select` met `flex: 1 1 150px`), dus twee per rij op een telefoon.

## Opmaak van de detailkaart
- De kaart is een schermvullend venster: kop en knoppenbalk staan VAST, alleen het
  middenstuk schuift (`S.detailBody`). "Bewerken" moet altijd bereikbaar zijn zonder
  te scrollen — zet er dus nooit een knoppenbalk in die meeschuift.
- Onderaan staan drie knoppen die de breedte delen (`S.detailFoot`, grid 1fr 1fr 1fr).
  Laat ze niet wikkelen: een halve rij met één knop ziet er rommelig uit.
- Elk blok is een `Vak` met hetzelfde opschrift en dezelfde afstand. Korte kenmerken
  zijn chips van gelijke hoogte; lange waarden (druif, streek) zijn `Feit`-rijen met
  een label links. Zet nooit een lange tekst in een chip: die neemt dan een hele rij.

## Waar de wijn gemaakt wordt
- Een APPELLATIE is vaak geen plaats op de kaart: "Pessac-Léognan" en
  "Gevrey-Chambertin 1er Cru" vinden niets, "Léognan" en "Gevrey-Chambertin" wel.
  `geoVarianten()` maakt de vraag stap voor stap eenvoudiger (haakjes weg, "grand
  cru" weg, samengestelde namen splitsen, losse delen van een omschrijving).
- Volgorde: eerst de streek, dan de omschrijving bij de fles (`geoReserve`, bv.
  "Passopisciaro, Etna, Sicilië" → het echte dorp op de Etna), en pas als laatste
  het land. Een ruwe plek is beter dan geen plek.
- De naam bij de speld komt van de GEOCODER zelf, niet van het model: zo zegt het
  opschrift ook echt waar de speld staat.
- Het bewerkvenster bevat GEEN proefnotities en geen sommelier: die horen op de
  detailkaart, waar het draaiboek naast staat.

## Kaart
- De knop "Kaart" in de kop toont alle flessen die een `lat`/`lng` hebben op een
  echte kaart (`KaartModal`). Flessen die nog geen locatie hebben, worden geteld
  en vermeld — nooit stilzwijgend weggelaten.
- Leaflet zit MEE IN DE BUNDEL (`npm run bundle` gebruikt `--loader:.css=text`,
  de stijl wordt bij het openen in de pagina gezet). Geen CDN, geen sleutel, geen
  kosten. De tegels komen van OpenStreetMap; zonder netwerk blijft de kaart leeg,
  de rest van de app werkt gewoon door.
- `sw.js` cachet enkel bestanden van de app zelf; kaarttegels van een ander domein
  gaan bewust rechtstreeks naar het netwerk.
- Alle flessen van DEZELFDE PRODUCENT staan op één pin: het is hetzelfde domein.
  De opzoeking geeft per jaargang wel eens een andere streeknaam terug, en dan
  stond dezelfde wijn verspreid over de kaart. De pin staat op de MEDIAAN van de
  gekende punten, zodat één uitschieter ze niet kan verslepen. Zonder producent
  valt de groepering terug op de coördinaten (2 decimalen). Tik je op een pin,
  dan verschijnt de lijst en kan je naar de detailkaart springen.
- Er wordt NOOIT iets opgezocht bij het openen van de kaart: ze gebruikt alleen de
  coördinaten die al bij de fles staan.

## Meldingen (anoniem)
- Onderaan het menu staat "Meld een probleem of idee" → `FeedbackModal` →
  `/api/feedback` → Resend.
- Het e-mailadres staat NOOIT in de code of in de client: enkel in de Vercel-
  omgevingsvariabele `FEEDBACK_EMAIL` (sleutel in `RESEND_API_KEY`). Afzender is
  `onboarding@resend.dev`, onderwerp "Kelder-app: melding", body = melding +
  appversie.
- Elke melding gaat daarnaast ook bovenaan `FEEDBACK.md` in de hoofdmap van de
  repo, via de GitHub Contents API met `GITHUB_TOKEN` (repo
  `thomasbuysekelder/Wijnkelder`, branch `main`). Formaat: `## datum · appversie`
  gevolgd door de tekst. Dat is een EXTRA: ontbreekt de token of faalt GitHub,
  dan wordt het stil overgeslagen — de mail vertrekt sowieso en de melder merkt
  er niets van. De token staat enkel in de omgevingsvariabele.
- De melder ziet enkel "Verzonden, bedankt" of "Versturen lukte niet, probeer
  later opnieuw" — nooit een foutdetail, zodat er niets over de configuratie lekt.
- `APP_VERSION` in `app.jsx` gaat mee als appversie en moet gelijk blijven aan het
  cachenummer in `sw.js`.

## Recensies
- Nooit een recensie, citaat of score verzinnen. Enkel wat in de zoekresultaten
  staat. Is er niets, dan zegt de app dat: "Geen recensie gevonden."
- `lookupWineFull()` doet TWEE gratis zoekopdrachten naast elkaar: één voor
  prijs/algemeen en één gericht op recensies en proefnotities. Het model vat die
  tweede samen in 2 à 3 zinnen met bronvermelding. Beide zijn gratis; er gaat nog
  altijd maar één Haiku-call overheen.
- De Vivino-score is een AANVULLING op die tekst, nooit de hele inhoud. Is er geen
  enkele recensie gevonden, dan begint het veld met "Geen recensie gevonden." en
  komt het cijfer daarachter — anders leest een gemiddelde van duizenden
  gebruikers als een proefnotitie.
- Staat er niets voor de exacte jaargang, dan mag een recensie van een andere
  jaargang van dezelfde wijn, maar verplicht met vermelding: "Recensie van
  jaargang JAAR, ter indicatie:". `score` blijft dan leeg (die geldt enkel voor
  de eigen jaargang).
- De Vivino-score wordt in code toegevoegd door `applyReviews()`/`vivinoLine()`,
  met aantal beoordelingen en jaargang; het model mag Vivino niet zelf vermelden,
  zo kan het cijfer niet verzonnen worden.

## Vraag de sommelier
- Knop in de kop opent `SommelierModal`: bijna schermvullend, tekst 16px,
  scrollend antwoordgebied en een invoerveld dat onderaan blijft staan.
- De APP filtert eerst zelf, deterministisch en zonder AI: `parseCriteria()` leest
  maximumprijs, kleur en "nu op dronk" uit de vraag, `matchesCriteria()` houdt
  enkel de flessen over die daaraan voldoen (en waarvan er nog minstens één in de
  kelder ligt). Enkel die kandidaten gaan mee. Zo kan het model niets aanraden
  dat niet aan de vraag voldoet.
- Een fles met ONBEKENDE prijs valt af zodra er een prijsgrens in de vraag staat —
  je kan niet garanderen dat ze eronder zit. Het aantal weggelaten flessen gaat
  mee in de prompt, zodat de sommelier dat eerlijk kan melden.
- Past er niets, dan laat `relaxCriteria()` de criteria één voor één vallen en
  wordt de lijst expliciet als "voldoet NIET aan alle criteria" meegestuurd; het
  model moet dan zeggen dat er niets past en per suggestie zeggen wát er niet klopt.
- Begrensd op 30.000 tekens. `somRuimte()` zet eerst de kale regels van ALLE
  kandidaten vast en verdeelt wat overblijft eerlijk over de flessen. Krimpt die
  ruimte, dan sneuvelt eerst de beschrijving, dan de recensie, dan mijn losse
  notitie. MIJN EIGEN PROEFNOTITIE verdwijnt als ALLERLAATSTE — die staat nergens
  anders. Pas als zelfs de kale regels niet meer passen, vallen er wijnen af.
  Wat er gesnoeid werd, staat in de prompt zodat de sommelier het kan melden.
- Een vervolgvraag stuurt de laatste twee beurten beknopt mee (antwoord afgekapt
  op 600 tekens).

## Uitzondering op de modelregel: beide sommeliers draaien op Sonnet
- `SOMMELIER_MODEL = "claude-sonnet-4-6"` geldt voor de kelderbrede sommelier EN
  voor de vraag over één fles op de detailkaart (`askWineQuestion`). Dat zijn de
  enige twee plekken waar geen Haiku draait; de eigenaar keurde ±2 cent per
  vraag over één fles goed omdat het antwoord op Haiku te vlak was.
- Beide krijgen ALLES mee wat de app over een fles weet, inclusief de eigen
  proefnotitie van de gebruiker (gemarkeerd als `MIJN EIGEN PROEFNOTITIE`). De
  opdracht verbiedt uitdrukkelijk te beweren dat die notitie er niet is.
- `SOMMELIER_MODEL = "claude-sonnet-4-6"` is de ENIGE plek waar geen Haiku draait.
  De eigenaar keurde hiervoor 3 à 5 cent per vraag goed, omdat de kwaliteit van
  het advies hier het belangrijkste is. Alle andere aanroepen blijven Haiku.
- In de praktijk kost een vraag ±1,5 cent: door de voorfiltering is de
  kandidatenlijst klein (enkele honderden tokens) en staat `max_tokens` op 900.
  `thinking` staat bewust op `disabled` — anders tellen denk-tokens mee in
  `max_tokens` en wordt het antwoord afgekapt.
- Geen tools, ook hier niet: de web_search-regel hierboven blijft gelden.

## Drinklogboek
- De knop "Fles weg" op de detailkaart opent `DrinkModal`: je vinkt er een AANTAL
  flessen tegelijk af (nooit meer dan er in de kelder liggen), met een datum.
- `WEG_REDENEN` bepaalt waarom een fles verdwijnt: gedronken, verkocht, weggegeven,
  kapot. ENKEL "gedronken" telt mee in de drinkstatistiek; verkocht en weggegeven
  worden apart gemeld. Het draaiboek verschijnt alleen bij "gedronken". Een regel
  zonder `type` is oud en telt als gedronken.
- Proeven gebeurt met AANVINKBARE woorden (kleur, neus primair/secundair/tertiair,
  smaak, evolutie) die als lijstjes bewaard worden, zodat er later op geteld kan
  worden. Het veld "eigen woorden" vangt op wat er niet tussen staat. Zet nieuwe
  aromawoorden altijd in `DRINK_VRAGEN`, nooit los in een component.
- `RIJPHEID` zet mijn oordeel ("mooi op dronk", "kort bewaarpotentieel", "over de
  piek") in dezelfde keuzelijst als de termijn in jaren; beide voeden `herproefOp`.
- `DRINK_VRAGEN` is het vaste draaiboek. Alles mag leeg blijven; wat leeg is, is
  niet van toepassing en komt NIET in het logboek. Vraag je een veld erbij, zet
  het in die ene lijst — het venster, het logboek op de detailkaart en de
  samenvatting voor de sommelier lezen alle drie uit die lijst.
- Elke afvinking schrijft een regel in `b.drinkLog`: datum, aantal, de waarde per
  fles OP DAT MOMENT (`effVal`) en de ingevulde antwoorden. Die waarde wordt
  bewust bevroren, zodat een latere prijsopzoeking de geschiedenis niet herschrijft.
- De indruk gaat daarnaast bij `tasteNotes` (met datum ervoor), want dat is het
  veld dat de sommelier leest. `herproefOp` (jaartal) voedt het filter
  "Klaar om te herproeven".
- De knop "Logboek" in de kop opent `LogboekModal`: alle regels van alle flessen,
  nieuw naar oud, per maand gegroepeerd, met de tellingen erboven. Tik je een regel
  aan, dan open je die fles.
- Een fles die je ELDERS dronk (restaurant, bij vrienden) krijgt `buitenKelder: true`
  en `quantity: "0"`. Ze telt mee in het logboek en bij de sommelier, maar NIET in
  de kelderlijst, de statistiek, de kaart, de Excel-export of de dubbelcontrole:
  daarvoor bestaat `kelder` (= `bottles` zonder `buitenKelder`). Gebruik overal
  `kelder` behalve waar het logboek zelf bedoeld is.
- Een regel wissen in het logboek is een ECHTE ongedaanmaking: de flessen komen
  terug in de kelder. Een fles van elders verdwijnt helemaal zodra haar laatste
  regel weg is. `logRegels()` houdt daarvoor met `bron` de oorspronkelijke regel
  bij; de rijen in het venster zijn kopieën.
- `drinkSamenvatting()` telt deze maand / dit jaar / totaal DETERMINISTISCH in code
  en geeft die cijfers aan de sommelier. Het model mag daar zelf niets bijrekenen —
  zo kan "voor hoeveel geld heb ik deze maand wijn gedronken" niet fout gaan.

## Indeling van de kop
- Rechtsboven staat wat TOEVOEGT: Foto, Fles, en de drie puntjes met de
  instellingen (backup, herstel, Excel, melding).
- Daaronder staat op een eigen rij wat VERKENT: Sommelier, Logboek, Kaart. Die drie
  delen de breedte, zodat ze op een telefoon niet wegvallen of afbreken.
- Zet nieuwe knoppen in de rij waar ze thuishoren; laat de kop niet opnieuw
  volledig vollopen.

## Kostenregels (belangrijk voor de eigenaar)
- ALLE AI-aanroepen draaien op Haiku (claude-haiku-4-5-20251001). Gebruik nooit
  een duurder model zonder expliciete vraag van de eigenaar.
- Gebruik NOOIT de ingebouwde web_search-tool van de API: zelfs met max_uses:1
  kostte één opzoeking ~$0,28 door de omvang van de teruggegeven resultaten.
  Deze regel blijft onverkort gelden. Zoeken gebeurt via het eigen gratis endpoint
  `/api/search` (snippets afgekapt op ~2600 tekens + prijzen) dat als tekst wordt
  meegegeven aan één Haiku-call.
- Eén volledige opzoeking (`lookupWineFull`) kost ±1 cent: `/api/search` is gratis
  en er gaat één Haiku-call overheen. Daarom is automatisch opzoeken bij het
  TOEVOEGEN van een fles toegestaan (na foto-analyse, na zoeken op naam, en in de
  achtergrond na handmatig toevoegen).
- Bij bulk-invoer van meerdere jaargangen MAG er per jaargang opgezocht worden,
  maar enkel als de gebruiker het vinkje aan laat staan. De geschatte kost staat
  bij dat vinkje (±1 cent per jaargang). De opzoekingen lopen ÉÉN VOOR ÉÉN, nooit
  parallel: Brave laat op de gratis laag één bevraging per seconde toe en elke
  opzoeking doet er meerdere.
- Nog altijd verboden: opzoeken in lussen of bij het openen/tonen van een fles.
- Upload-afbeeldingen blijven max 1200px JPEG.

## Releaseroutine
Sluit ELKE wijzigingsopdracht altijd automatisch af met, in deze volgorde:
1. `npm run bundle`
2. het cachenummer in `sw.js` één hoger (`kelder-vN`) én `APP_VERSION` in
   `app.jsx` op dezelfde waarde
3. commit + push naar `main`

Doe dit ook als de gebruiker er niet om vraagt.
