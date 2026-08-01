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
- `/api/search` haalt naast de DuckDuckGo-snippets ook Vivino-aanbiedingen op
  (EUR, markt BE, per jaargang); `marketPrice()` in `app.jsx` kiest de exacte
  jaargang, anders naburige jaargangen, en negeert andere flesformaten.
- Vivino is een NIET-OFFICIËLE bron (ongedocumenteerd endpoint) en wordt hier
  enkel voor persoonlijk gebruik aangesproken. Bij commercialisering van deze app
  moet die bron vervangen worden door een officiële databron met licentie.
- Vivino is een extra bovenop de snippets, geen vereiste: valt de bron weg of
  geeft ze niets terug, dan blijven de snippets werken en blijft de prijs anders
  gewoon leeg.
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
- De Vivino-score is een AANVULLING op die tekst, nooit de hele inhoud.
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
- Begrensd op 30.000 tekens: eerst vallen de proefnotities weg, daarna de laatste
  wijnen (dat wordt in het antwoord gemeld).
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
