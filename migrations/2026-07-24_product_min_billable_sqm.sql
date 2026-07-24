-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Förutsätter att migrationen 2026-07-24_product_price_per_sqm.sql redan körts.

-- Byter ut "minsta debiterbar bredd" (mm) mot "minsta debiterbar yta" (m², 2 decimaler) för
-- m²-prissatta produkter - en smal men hög beställning kunde annars bli felaktigt billig.
ALTER TABLE products
  CHANGE COLUMN min_billable_width min_billable_sqm DECIMAL(10,2) NULL;
