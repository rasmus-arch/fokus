# Att göra – nästa session

Anteckningar från Rasmus 2026-07-24 kväll, att ta upp nästa session.

## 1. Auto-spara offerter
Offertbyggaren ska inte ha en manuell "Spara"-knapp. Varje ändring/klick ska
sparas direkt istället (dvs. anropa spara-endpointen löpande, inte bara vid
knapptryck). Gäller `quote-builder.html` + `saveQuote()`.

## 2. Köpeavtal/offert-PDF saknar information
Enligt Rasmus innehåller varken köpeavtalet eller offerten just nu bänkskiva,
lucka eller ytbehandling - trots att vi kopplade ihop auto-ifyllningen av
"Material bänkskiva"/"Färg bänkskiva"/"Modell lucka" i offertbyggaren
(commit 96937d2). Måste undersökas: sitter felet i själva PDF-genereringen
(server.js, SPECIFIKATION-blocket) eller är det data som inte sparas/når
fram dit? Kolla att `kitchenSpecs` faktiskt persisteras och läses korrekt
i `/api/quotes/:id/pdf`.

## 3. Bygg om PDF-layouten
Vill göra om:
- Kunduppgifter (hur de visas på köpeavtal/offert)
- Dokumentinfo
- Hur produkter visas i produktlistan på PDF:en

Inga detaljer om exakt hur ännu - be Rasmus specificera önskat utseende
innan implementation.

## 4. Nya köpvillkor
Byt ut nuvarande köpvillkor/avtalstext (company_settings.agreement_text,
redigeras under Inställningar → Företagsinfo) mot en ny text som Rasmus
skrivit med hjälp av Gemini. Vänta på att han klistrar in/skickar den nya
texten, lägg in den via inställningssidan (eller direkt i databasen om han
föredrar det).
