-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Stöd för produkter som prissätts per kvadratmeter istället för styckpris (t.ex. skivmaterial
-- som säljs på mått, men som INTE är en lucka/lådfront - de har redan sitt eget system via
-- dörrmodeller/door_price_items). Säljaren matar in bredd/höjd i offertbyggaren, priset räknas
-- ut som bredd(m) x höjd(m) x price_per_sqm - med bredden aldrig lägre än min_billable_width,
-- så en smal beställning ändå debiteras en rimlig minimibredd.
ALTER TABLE products
  ADD COLUMN pricing_type VARCHAR(20) NOT NULL DEFAULT 'unit',
  ADD COLUMN price_per_sqm DECIMAL(10,2) NULL,
  ADD COLUMN min_billable_width INT NULL;
