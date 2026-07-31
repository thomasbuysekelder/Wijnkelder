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
Alles staat in de hoofdmap van de repo. `vercel.json` schakelt build/install op Vercel
bewust uit: pushen naar `main` deployt de bestanden zoals ze zijn. Bouw dus altijd
lokaal vóór het committen.

## Prijsbepaling
- De foto-analyse zelf zoekt niets op (enkel etiket + kennis van het model); de
  prijs daaruit is een ruwe schatting die meteen daarna door de opzoeking wordt
  vervangen.
- De retailprijs komt uit echte winkelprijzen, niet uit een gok van het model.
  `/api/search` haalt naast de DuckDuckGo-snippets ook Vivino-aanbiedingen op
  (EUR, markt BE, per jaargang); `marketPrice()` in `app.jsx` kiest de exacte
  jaargang, anders naburige jaargangen, en negeert andere flesformaten.
- Vivino is een NIET-OFFICIËLE bron (ongedocumenteerd endpoint) en wordt hier
  enkel voor persoonlijk gebruik aangesproken. Bij commercialisering van deze app
  moet die bron vervangen worden door een officiële databron met licentie.
- Vivino is een extra bovenop de snippets, geen vereiste: valt de bron weg of
  geeft ze niets terug, dan blijft alles werken op de snippets en de kennis van
  het model, met "schatting" in `priceNote`.
- Waar de prijs op steunt, staat altijd in `priceNote` en is zichtbaar op de
  detailkaart. Een nieuwe opzoeking mag de retailprijs overschrijven (anders kan
  je een foute prijs nooit corrigeren); `ownValue` en `purchasePrice` niet.
- DuckDuckGo beantwoordt GET-verzoeken vanaf een server met een lege pagina
  (HTTP 202). `/api/search` moet dus met POST zoeken.

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
- Nog altijd verboden: opzoeken in lussen of bij het openen/tonen van een fles,
  en automatisch opzoeken bij bulk-invoer van meerdere jaargangen — daar blijft
  de expliciete tik op "Info opzoeken" gelden.
- Upload-afbeeldingen blijven max 1200px JPEG.

## Releaseroutine
Sluit ELKE wijzigingsopdracht altijd automatisch af met, in deze volgorde:
1. `npm run bundle`
2. het cachenummer in `sw.js` één hoger (`kelder-vN`)
3. commit + push naar `main`

Doe dit ook als de gebruiker er niet om vraagt.
