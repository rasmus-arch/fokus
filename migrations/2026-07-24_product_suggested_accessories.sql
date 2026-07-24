-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Föreslagna tillbehör per produkt (t.ex. "till detta skåp föreslås denna karusell") -
-- en JSON-array med produkt-ID:n, samma mönster som products.gallery/variations.
ALTER TABLE products
  ADD COLUMN suggested_accessories JSON NULL;
