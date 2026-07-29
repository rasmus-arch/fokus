-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Paketprodukter (t.ex. "Vitvarupaket Bosch", "Belysningspaket") - en namngiven grupp av
-- befintliga produkter med antal, som läggs till i offerten som sina egna rader med ett klick.
-- items lagras som JSON (samma mönster som products.variations/suggested_accessories) istället
-- för en egen kopplingstabell, eftersom det bara är enkel structured data utan eget behov av
-- att JOIN:as/sökas på i SQL.
CREATE TABLE product_packages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  items JSON NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
