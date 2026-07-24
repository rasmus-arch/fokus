-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Samma "Faktor"-fält som redan finns för variantprodukter (variations-JSON), men för vanliga
-- produkter utan varianter. Används för att räkna ut försäljningspris automatiskt från
-- inköpspris x faktor x moms, precis som i varianttabellen.
ALTER TABLE products
  ADD COLUMN markup_factor DECIMAL(10,4) NULL;
