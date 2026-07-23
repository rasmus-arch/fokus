-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Tillval per material: om på, prissätts färger via delade prisgrupper
-- istället för individuellt per färg.
ALTER TABLE countertop_materials
  ADD COLUMN use_price_groups TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE countertop_price_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  name VARCHAR(255) NOT NULL
);

-- En färg kan tillhöra en prisgrupp (gäller bara material med use_price_groups = 1).
ALTER TABLE countertop_colors
  ADD COLUMN price_group_id INT NULL;

-- En prisrad hör antingen till en enskild färg (color_id, som idag) eller till
-- en hel prisgrupp (price_group_id) - exakt en av de två sätts per rad.
ALTER TABLE countertop_prices
  MODIFY COLUMN color_id INT NULL,
  ADD COLUMN price_group_id INT NULL;
