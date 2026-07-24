-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen.
-- OBS: Detta är INTE en schemaändring utan ytterligare startdata (seed) för
-- Kunskapsbanken. Kör bara EN gång - kör man den två gånger skapas dubbletter.
--
-- Kompletterar de två tidigare "Gångjärn"-korten (från 2026-07-24_seed_kunskapsbank_grundfakta.sql)
-- med mer precisa täckningsgränser och ett helt nytt ämne: lyftbeslag för luckor
-- ovanför kyl/frys som öppnas uppåt. Källan är branschgenerell Blum/Häfele-terminologi
-- (HK-XS, Huwilift, HK-S är riktiga, vedertagna produktnamn i branschen), inte
-- knutet till någon specifik leverantörs eget beställningssystem.

INSERT INTO knowledge_base_articles (title, category, content, images, pdfs) VALUES
(
  'Gångjärn - exakta täckningsgränser och plattkombinationer',
  'Gångjärn',
  'Mer precisa täckningsgränser (hur mycket av stommens kant som döljs av luckan) för vanliga dämpade gångjärn:
- 19 mm gångjärn: täcker ca 16,5-18 mm (max 18 mm)
- 16 mm gångjärn: täcker ca 14-16,5 mm (max 16,5 mm)
- 7 mm gångjärn (halvtäck): täcker ca 5-7,5 mm

Gångjärnshålet borras normalt ca 5 mm in från luckans kant.

45-graders gångjärn (hörnskåp): mät innermåttet på skåpet och lägg på ca 2 mm sammanlagt för att få luckans totalbredd. Ska luckan istället ligga tätt an mot stommen används en Inserta-variant och man lägger på ca 3 mm istället. Det finns flera varianter av hörnskåp - kontrollera alltid mot er egen leverantörs skisser innan beställning.

90-graders/"diskbänksgångjärn" (när luckan ligger parallellt med stommen med ett litet mellanrum, t.ex. 2 mm): mät innermåttet, dra av mellanrummet på ena sidan och lägg på som vanligt på andra sidan.

95-graders "utanpåliggande" gångjärn: används när ett vanligt gångjärn inte får plats inne i skåpet (t.ex. stora skåp typ 1200 mm, eller när man inte vill att gångjärnet ska synas inuti skåpet). Kräver att det finns minst ca 67 mm fritt djup bakom luckan för att gångjärnet ska få plats. Vilken gångjärnsplatta som ska användas beror på stommens tjocklek:
- 16 mm stomme -> 6 mm platta
- 18 mm stomme -> 3 mm platta
- 22 mm stomme -> 0 mm platta

Gångjärnsplattor (avståndet mellan gångjärn och stomme) finns normalt i fyra tjocklekar: 0 mm (standard/"renoveringsplatta"), 3 mm, 6 mm och 9 mm. Genom att kombinera gångjärnets egen täckning med en tunnare eller tjockare platta kan man finjustera exakt hur mycket av stommens kant som ska synas - t.ex. ger ett 16 mm gångjärn med en 3 mm platta ca 13 mm synlig kant (16 - 3 = 13).',
  '[]', '[]'
),
(
  'Lyftbeslag för luckor ovanför kyl/frys (öppnas uppåt)',
  'Gångjärn',
  'När en lucka sitter ovanför ett inbyggt kylskåp/frys och behöver öppnas uppåt istället för på vanligt gångjärnssätt används särskilda lyftbeslag. Tre vanliga alternativ i branschen, med olika krav på stommens fria innerhöjd:

**Alternativ 1 (kompaktast):** kräver minst ca 200 mm fri innerhöjd i stommen. Monteras som ett tillbehör på ena sidan i skåpet, tillsammans med två vanliga gångjärn (t.ex. 19 eller 16 mm) i själva luckan.

**Alternativ 2 (mellanalternativ):** kräver minst ca 175 mm fri innerhöjd. Monteras på samma sätt - ett lyftbeslag på ena sidan plus två vanliga gångjärn i luckan.

**Alternativ 3 (lägst höjdkrav, dyrare):** kräver minst ca 150 mm fri innerhöjd. Till skillnad från de andra två monteras detta i par (ett på vardera sidan av skåpet) och ersätter helt vanliga gångjärn - ingen ordinarie gångjärnsborrning ska göras alls.

Tumregel vid projektering: mät alltid stommens fria innerhöjd innan ni väljer lyftbeslag - för låg höjd gör att beslaget inte får plats och man tvingas gå upp till ett dyrare alternativ med lägre höjdkrav.',
  '[]', '[]'
);
