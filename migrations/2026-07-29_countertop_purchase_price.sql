-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Bänkskivepriser hade ingen kostnadsdata alls tidigare (bara försäljningspris per lpm),
-- vilket gjorde det omöjligt att räkna ut marginal på bänkskivor. Lägger till inköpspris
-- per löpmeter (ex moms, precis som produkternas purchase_price) parallellt med det
-- befintliga försäljningspriset price_per_lm (inkl moms).
ALTER TABLE countertop_prices
  ADD COLUMN purchase_price_per_lm DECIMAL(10,2) NULL;
