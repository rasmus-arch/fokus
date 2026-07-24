-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- Konfigurerbara accentfärger för OFFERT-PDF:en (hämtade från företagets logga som
-- standardvärden, men redigerbara under Företagsinfo om loggan byts ut).
ALTER TABLE company_settings
  ADD COLUMN pdf_color_primary VARCHAR(7) NOT NULL DEFAULT '#2E5339',
  ADD COLUMN pdf_color_accent VARCHAR(7) NOT NULL DEFAULT '#E8A33D';
