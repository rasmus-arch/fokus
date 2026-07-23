-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen (systemet har ingen
-- automatisk migrationskörare). Säkert att köra även om kolumnerna redan skulle
-- finnas är de INTE - kör bara en gång.

-- Leads: håll koll på varifrån ett lead kom, och tappa inga formulärfält som inte
-- känns igen (namn/e-post/telefon/kommun) - de sparas som JSON istället.
ALTER TABLE leads
  ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'Manuell',
  ADD COLUMN extra_data JSON NULL;

-- Företagsinställningar: uppgifter för Facebook/Meta Lead Ads-webhooken.
ALTER TABLE company_settings
  ADD COLUMN fb_verify_token VARCHAR(255) NULL,
  ADD COLUMN fb_page_access_token TEXT NULL,
  ADD COLUMN fb_app_secret VARCHAR(255) NULL;
