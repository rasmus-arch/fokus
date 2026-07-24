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

## 3. Bygg om PDF-layouten - delvis klart (commit b5a5c7b)
Klart: kunduppgifter (Namn/Pers.nr/Adress/Telefon/E-post visas alltid,
Adress rad 2/Lgh-nr/BRF/Fastighetsbet bara när ifyllda), Dokumentinfo →
"Datum", footer med företagsnamn/org.nr/momstext, ordernummer under
KÖPEAVTAL-rubriken.

Kvarstår: hur produkter visas i produktlistan på PDF:en. Rasmus har inte
specificerat vad som är fel/önskat där än - fråga honom innan
implementation.

## 4. Nya köpvillkor
Rasmus klistrar in den nya avtalstexten (skriven i Gemini) själv under
Inställningar → Företagsinfo. Ingen åtgärd behövs från oss om han inte
ber om hjälp med det.

## 5. "Kundläge"-knapp som döljer priser
Ny knapp i footern (överallt) eller längst ner i sidomenyn, typ
"Kundläge", som döljer priser i gränssnittet - tänkt för att kunna vända
skärmen mot kunden och visa t.ex. produktbilder utan att visa priser.
Inga detaljer om exakt vilka vyer/priser som ska döljas än - fråga
Rasmus vad som ska synas/döljas i kundläge innan implementation.

## 6. Möjlig kvarstående bugg: montagepris beräknas inte automatiskt
Rasmus rapporterade att montagepriset "verkar inte räknas ut automatiskt
när man lägger till produkter i offerten". Kodgranskning (utan konkret
repro) visar två separata mekanismer som styr montagepris för produkter:
- Vanlig produkt utan varianter: `products.installation_price`/
  `installer_share` måste vara manuellt ifyllt i produktregistret -
  ingen automatisk beräkning finns för själva skåpstommen.
- Produkt med varianter: install-pris kommer från den valda variantens
  `install_price`/`installer_share` (satt i variant-tabellen).
- Skåp med frontkonfiguration (frame_type, "lucka"/"lådfront"): kräver
  att en **dörrmodell är vald** under Specifikationer i offertbyggaren -
  annars visas ett alert och inga fronter (eller deras montagepris)
  läggs till alls.
Inget uppenbart kodfel hittat i själva beräkningslogiken (renderCart()
summerar installIncVat korrekt). Nästa steg: be Rasmus om ett konkret
exempel (vilken produkt/variant, var en dörrmodell vald, vilket pris
förväntades vs syntes) innan vi gräver vidare.

## 7. Byte av dörrmodell i en offert räknar inte om fronter/luckor
Rasmus 2026-07-24: när man byter dörrmodell på en befintlig offert ska
alla redan tillagda fronter/luckor räknas om mot den nya modellens priser
(just nu ligger de troligen kvar med priser från den gamla modellen).
Ingen kodgranskning gjord än - börja med att hitta var dörrmodell-bytet
hanteras i offertbyggaren (quote-builder.html) och se om
front-/luckpriserna verkligen borde uppdateras automatiskt vid byte,
eller om Rasmus vill ha en bekräftelsedialog ("Räkna om priser?") istället
för att tyst skriva över eventuella manuella justeringar.
