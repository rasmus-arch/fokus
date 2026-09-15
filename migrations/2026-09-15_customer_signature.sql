-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.
-- Lägger till stöd för att kunden signerar (ritad signatur) och bekräftar sina uppgifter samt
-- laddar upp ett foto på sin legitimation när de godkänner en offert via den digitala länken.

ALTER TABLE quotes
  ADD COLUMN customer_signature_data LONGTEXT NULL,
  ADD COLUMN customer_id_photo_path VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_name VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_personnummer VARCHAR(20) NULL,
  ADD COLUMN customer_confirmed_address VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_address2 VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_apartment_number VARCHAR(50) NULL,
  ADD COLUMN customer_confirmed_brf_org_nr VARCHAR(50) NULL,
  ADD COLUMN customer_confirmed_property_designation VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_email VARCHAR(255) NULL,
  ADD COLUMN customer_confirmed_phone VARCHAR(50) NULL;
