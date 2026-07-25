-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Antal lådor för moduler av formen "drawers" (t.ex. en trelådshurts) - styr hur många
-- lådfrontslinjer som ritas i ritningen så modulen faktiskt ser ut som t.ex. tre lådor.
ALTER TABLE drawing_modules
  ADD COLUMN drawer_count INT NULL;
