-- Körs manuellt i cPanel/phpMyAdmin mot produktionsdatabasen. Kör bara en gång.

-- sessions.token slås upp på VARJE inloggat API-anrop (lib/auth.js requireAuth) - utan
-- index blir det en fullständig tabellgenomsökning per anrop.
ALTER TABLE sessions ADD INDEX idx_token (token);

-- Kolumner som ofta filtreras/joinas i vanliga listvyer och prisuppslag.
ALTER TABLE quotes ADD INDEX idx_customer_id (customer_id);
ALTER TABLE quotes ADD INDEX idx_status (status);
ALTER TABLE products ADD INDEX idx_category (category);
ALTER TABLE door_price_items ADD INDEX idx_model_id (model_id);
