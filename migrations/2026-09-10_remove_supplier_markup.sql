-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Valfri städning: "Prispåslag" per leverantör togs bort ur gränssnittet eftersom
-- det gjorde exakt samma sak som "Faktor" på produkter (pris = inköpspris x faktor
-- x moms), fast mindre flexibelt (samma påslag för alla produkter hos leverantören
-- istället för per produkt). Kolumnen används inte längre av koden - säkert att
-- droppa när som helst, men inget brådskar.

ALTER TABLE suppliers DROP COLUMN markup_percent;
