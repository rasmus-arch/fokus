# Att göra – nästa session

Anteckningar från Rasmus 2026-07-24 kväll, att ta upp nästa session.

## 1. Auto-spara offerter - KLART (commit f7724b2)
Offertbyggaren sparar nu löpande (debounce 800ms) istället för via en
manuell "Spara"-knapp, som är borttagen. Statusindikator i headern.

## 2. Köpeavtal/offert-PDF saknar information - trolig grundorsak fixad (commit f7724b2)
Root cause: "Skapa PDF" var bara en vanlig länk som läste senast SPARADE
data. Om man aldrig hann klicka "Spara" efter att ha lagt till en bänkskiva/
valt dörrmodell innan man öppnade PDF:en, saknades specifikationerna. Nu
sparar PDF-knappen (utan debounce) och väntar in det innan dokumentet
öppnas, och auto-spara (punkt 1) gör att data sällan hinner bli osparad
över huvud taget. Bekräfta med Rasmus att detta faktiskt löste hans
observerade problem nästa gång han testar - om det kvarstår, gräv djupare
i SPECIFIKATION-blocket i server.js.

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
