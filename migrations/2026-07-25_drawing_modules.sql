-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Modulbibliotek för den enkla ritfunktionen i offertbyggaren (trelådshurts, skåp med lucka,
-- passbit osv). Varje modul kan valfritt kopplas till en produkt så att en placerad modul i
-- ritningen automatiskt blir en prissatt rad i offerten.
CREATE TABLE drawing_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  product_id INT NULL,
  shape VARCHAR(20) NOT NULL DEFAULT 'door',
  frame_thickness DECIMAL(10,2) NULL,
  width_internal DECIMAL(10,2) NULL,
  width_external DECIMAL(10,2) NULL,
  depth DECIMAL(10,2) NULL,
  depth_internal DECIMAL(10,2) NULL,
  height_internal DECIMAL(10,2) NULL,
  height_external DECIMAL(10,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);
