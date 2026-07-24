-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen.
-- OBS: Detta är INTE en schemaändring utan startdata (seed) för Kunskapsbanken.
-- Kör bara EN gång - kör man den två gånger skapas dubbletter av korten
-- eftersom knowledge_base_articles inte har någon unik nyckel på titel.
--
-- Innehållet är sammanställt av Claude från flera bilagor användaren skickade in
-- (utbildningsmaterial, tekniska manualer m.m. från en konkurrent/leverantör).
-- Endast branschgenerella fakta är med - allt som var knutet till den specifika
-- avsändarens egna modellnamn, beställningssystem eller exakta fabrikstoleranser
-- är medvetet uteslutet, eftersom det kan skilja sig från er egen leverantör.

INSERT INTO knowledge_base_articles (title, category, content, images, pdfs) VALUES
(
  'Gångjärn - grundbegrepp och täckning',
  'Gångjärn',
  'Gångjärnets täckning avgör hur mycket av stommens sida som syns bredvid luckan efter montering. Vanliga dämpade gångjärnstyper (branschstandard):
- 19 mm gångjärn -> täcker ca 17-18 mm
- 16 mm gångjärn -> täcker ca 14-16 mm
- 7 mm gångjärn (halvtäck) -> täcker ca 5-7 mm

Gångjärnsplattan (avståndet mellan lucka och stomme) väljs efter stommens tjocklek:
- 16 mm stomme -> 6 mm platta
- 18 mm stomme -> 3 mm platta
- 22 mm stomme -> 0 mm platta

Standardmått vid borrning: hålet för själva gångjärnet ("gryta") är normalt ca 35 mm i diameter och 13 mm djupt, placerat ca 5 mm från luckans kant. Skruvhålen är ca 8 mm i diameter, 11 mm djupa. Vanlig cc-placering från luckans över-/underkant är 100 mm.

Antal gångjärn styrs normalt av luckans höjd: 2 st upp till ca 1100 mm, 3 st upp till ca 2100 mm, 4 st däröver.

OBS: exakta mm kan variera mellan leverantörer - dubbelkolla alltid mot er egen leverantörs specifikation innan beställning.',
  '[]', '[]'
),
(
  'Gångjärn - olika typer och när de används',
  'Gångjärn',
  '- 90 grader: standardgångjärn, används när luckan ligger vinkelrätt mot stommen (vanligast på raka skåp).
- 170 + 60 grader (används i par): till vinkelluckor. 170-gradersgångjärnet sitter på den lucka som ska öppnas, 60-gradersgångjärnet håller ihop de två luckorna utan att stjäla av innermåttet.
- 45 grader: används till hörnskåp, blir som stommens innermått. Kräver ofta 2 st silikondämpare (t.ex. 10 mm) för mjuk stängning.
- 95 grader ("utanpåliggande"): används när ett vanligt gångjärn inte får plats i skåpet, t.ex. på stora skåp (typ 1200 mm bredd).
- 0-insprång/0-täck: täcker en del av stommens kant men tar inget av innermåttet. Används när lådor eller korgar sitter monterade utan distans och inte får skymmas av luckan.

Minnesregel: ju bredare/tyngre luckan, desto fler gångjärnspunkter behövs för att undvika att luckan hänger snett över tid.',
  '[]', '[]'
),
(
  'Lådsystem - jämförelse av vanliga typer',
  'Lådor',
  'Tre vanliga nivåer av lådsystem i köksbranschen, med ungefärliga egenskaper (varierar per leverantör):

Enklare/äldre system:
- Ingen mjukstängning som standard
- Billigare, används ofta som nödlösning vid snabb renovering
- Sidhöjder varierar, ofta ca 54-150 mm beroende på lådans storlek

Mellansegment:
- Alltid dämpad/mjukstängande
- Går ofta att få förborrad för snabbare montage
- Finns ofta med "tryck-och-öppna"-funktion (inga handtag behövs)

Premiumsegment:
- Mjukstängande och tyst
- Finns med anpassade insatser (bestick, kryddor osv.)
- Dyrare men ger en lyxigare känsla, populärt i högre prissegment

Minsta invändiga djup för de flesta moderna dämpade lådsystem ligger ofta runt 280 mm - bra tumregel att ha i huvudet vid platsbrist.',
  '[]', '[]'
),
(
  'Smart köksrenovering - mätprinciper vid lucka- och lådfrontbyte',
  'Mätning och montage',
  'Grundidén med att bara byta luckor, lådfronter och bänkskiva istället för att riva ut hela köket kallas ofta "smart köksrenovering" - man behåller befintliga, fungerande stommar och byter bara det som syns.

Viktiga mätprinciper:
- Bestäm höjden på alla bänkluckor/lådor innan du mäter något annat - alla luckor och lådor på samma rad bör linjera med varandra.
- Höjden på bänkluckor räknas ofta som stommens utvändiga höjd minus ca 5 mm (minus ca 10 mm om det är diskbänk).
- Mät tjockleken på stommens sidor först - det avgör både luckans bredd och vilket gångjärn som ska användas (se kortet om gångjärnstäckning).
- Luckans bredd = invändig bredd + täckning vänster + täckning höger. Täckning vänster och höger måste inte vara lika stor.
- Undvik att luckans slutmått hamnar på en udda "8:a" i sista siffran (t.ex. 598 mm) - det blir ofta för snävt i praktiken.
- Ta alltid hänsyn till yttre faktorer innan du bestämmer slutmått: spis, kylskåp, fläkt, väggar, taklampor och liknande som kan vara i vägen.',
  '[]', '[]'
),
(
  'Vinhylla - räkna ut antal flaskor som får plats',
  'Hyllor och förvaring',
  'En vanlig branschtumregel för flaskhål i vinhyllor: varje flaskhål är ca 41 mm i diameter med ca 39 mm mellanrum mellan hålen. Genom att räkna baklänges från hyllans innermått kan man se hur många flaskor som får plats utan att sågsnittet hamnar mitt i ett hål.

Exempel:
- Innermått ca 167 mm -> plats för 2 flaskor
- Innermått ca 260 mm -> plats för 3 flaskor
- Innermått ca 338 mm -> plats för 4 flaskor

Tumregel: väldigt breda vinhyllor (400 mm och uppåt) blir sällan snygga rent sågmässigt - dela hellre upp i flera mindre hyllor än att sträcka en enda för mycket.',
  '[]', '[]'
),
(
  'Kokbokshylla - konstruktionsprinciper',
  'Hyllor och förvaring',
  'En fristående kokbokshylla (kan skruvas upp på vägg på egen hand) byggs ofta olika beroende på bredd för att inte bli för tung eller instabil:
- Smal hylla (upp till ca 120 mm bred): byggs ibland med två reglar istället för en hel rygg.
- Mellanbredd (ca 120-400 mm): byggs vanligen med en hel rygg.
- Bredare hyllor (400 mm och uppåt): återgår ofta till reglar istället för hel rygg, av stabilitetsskäl.

En hylla som monteras ihop med stommar bredvid (inte fristående) kan istället ha en tunnare rygg eftersom den får stöd av grannskåpen. Hyllplan i den typen av lösning är då ofta fasta och jämnt fördelade om inget annat anges.

Vill man ha glashyllplan istället för vanliga täckta hyllplan: räkna med att dra av några mm extra på bredd och djup jämfört med ett vanligt hyllplan, eftersom glashyllor ofta läggs i separata spår/glidskenor.',
  '[]', '[]'
),
(
  'Gavelsidor - uthäng beroende på kantprofil',
  'Fronter och luckor',
  'Gavelsidor (synliga sidopaneler i änden av en skåprad) ska normalt "hänga ut" en bit utanför stommens djup för att dölja gångjärn och kant snyggt. Hur mycket beror på vilken kantprofil/luckmodell som används i köket - en skarpare/rakare kant behöver oftast mindre uthäng än en rundad eller kraftigt profilerad kant.

Rådgör alltid med er egen leverantörs mått för respektive kantmodell innan beställning, eftersom exakta millimeter varierar mellan tillverkare och modellserier.

Om gavelsidans baksida är synlig (t.ex. ner mot golv eller upp mot tak) bör den vara belagd/laminerad på baksidan - annars räcker det oftast med en obelagd, vit baksida eftersom den ändå inte syns i vardagen.',
  '[]', '[]'
);
