# Kelder — installatie vanaf je iPhone

1. Zet ALLE bestanden uit deze zip in de hoofdmap van je GitHub-repository
   (Add file → Upload files → selecteer ze allemaal → Commit).
2. Maak één extra bestand aan: Add file → Create new file → typ als naam
   exact:  api/claude.js   (de schuine streep maakt vanzelf de map aan)
   en plak daarin de code die Claude je gaf. Commit.
3. Verwijder kelder-app.zip uit de repository (open het bestand → prullenbak).
4. Vercel bouwt automatisch opnieuw. Zet bij Vercel → Settings →
   Environment Variables ook je ANTHROPIC_API_KEY, en doe daarna
   Deployments → ⋯ → Redeploy.
5. Open je vercel.app-adres in Safari → Deel → Zet op beginscherm.

Data blijft lokaal op je iPhone bewaard, ook bij updates.
Backup via menu → Backup (kopieer) blijft je vangnet.
