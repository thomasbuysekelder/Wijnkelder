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

## Kostenregels (belangrijk voor de eigenaar)
- Foto-analyse en zoeken-op-naam draaien op Haiku (claude-haiku-4-5-20251001);
  foto-analyse ZONDER web search (prijs = schatting, gemarkeerd in notes).
- `lookupWineFull` (detailkaart "Info opzoeken") gebruikt Sonnet + web search en
  wordt UITSLUITEND door een expliciete tik van de gebruiker gestart. Voeg nooit
  automatische verrijkingen toe (bij openen, bij bulk, in lussen): elke call kost geld.
- Upload-afbeeldingen blijven max 1200px JPEG.
