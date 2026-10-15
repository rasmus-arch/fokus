-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Lägger till stöd för kvadratmeterpris på bänkskivor: en prisrad är antingen
-- 'lpm' (som förut: pris per löpmeter inom ett djupintervall) eller 'sqm' (pris per m²,
-- oavsett djup). Befintliga prisrader förblir 'lpm' och påverkas inte.

ALTER TABLE countertop_prices
  ADD COLUMN pricing_type VARCHAR(10) NOT NULL DEFAULT 'lpm',
  ADD COLUMN price_per_sqm DECIMAL(10,2) NULL,
  ADD COLUMN purchase_price_per_sqm DECIMAL(10,2) NULL;
