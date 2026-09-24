-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Tar bort legitimationsfoto-funktionen vid digitalt offertgodkännande helt (kolumn och,
-- separat, mappen private_uploads/id_photos på servern kan raderas manuellt om den finns).

ALTER TABLE quotes
  DROP COLUMN customer_id_photo_path;
