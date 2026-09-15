-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Lägger till stöd för att dela en offert som en säker länk till kunden, där
-- kunden kan godkänna eller avböja offerten digitalt.

ALTER TABLE quotes
  ADD COLUMN public_token VARCHAR(64) NULL UNIQUE,
  ADD COLUMN customer_response VARCHAR(20) NULL,
  ADD COLUMN customer_response_at DATETIME NULL,
  ADD COLUMN customer_response_ip VARCHAR(64) NULL,
  ADD COLUMN customer_response_user_agent VARCHAR(255) NULL,
  ADD COLUMN customer_response_snapshot LONGTEXT NULL,
  ADD COLUMN customer_decline_reason TEXT NULL;
