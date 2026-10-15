-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Lägger till valfritt inköpspris (ex moms) på bänkskivornas kantprofiler och tjänster
-- (bearbetningar), så de räknas med i marginalen i offertbyggaren. Befintliga rader får NULL
-- (inget inköpspris) och beter sig precis som förut tills ett inköpspris läggs in.

ALTER TABLE countertop_edges
  ADD COLUMN purchase_price_per_lm DECIMAL(10,2) NULL;

ALTER TABLE countertop_services
  ADD COLUMN purchase_price DECIMAL(10,2) NULL;
