-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Delade prisgrupper för dörrmodeller (flera dekornamn, t.ex. Standard/Dövad/Rund/R5,
-- delar exakt samma prislista för Lucka/Lådfront/Grytfront). Samma tabell återanvänds
-- för "tillbehörsgrupper" (en namngiven grupp av produkter som ska visas tillsammans
-- med en viss dörrmodell/prisgrupp i offertbyggaren) - konceptuellt är båda bara en
-- namngiven grupp, bara olika användning.
CREATE TABLE door_price_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

ALTER TABLE door_models
  ADD COLUMN price_group_id INT NULL,
  ADD COLUMN accessory_group_id INT NULL;

-- En prisrad hör antingen till en enskild modell (model_id, som idag) eller till en
-- hel prisgrupp (price_group_id) - exakt en av de två sätts per rad.
ALTER TABLE door_price_items
  MODIFY COLUMN model_id INT NULL,
  ADD COLUMN price_group_id INT NULL;

-- Taggar en produkt (typiskt ett tillbehör som Sockel/Kakellist) med vilken
-- tillbehörsgrupp den hör till, så den dyker upp i offertbyggaren när man filtrerar
-- på en dörrmodell som pekar på samma grupp via door_models.accessory_group_id.
ALTER TABLE products
  ADD COLUMN door_price_group_id INT NULL;
