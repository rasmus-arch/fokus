require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { hashPassword, verifyPassword, initSessions } = require('./lib/auth.js');
const db = require('./lib/db.js');
const { upload, uploadDir } = require('./lib/upload.js');
const { htmlToPdfmakeNodes, buildPdfImageCell, buildPdfHeroImageBlock, downloadExternalImage } = require('./lib/pdfHelpers.js');

let PdfPrinter = null;
try {
    PdfPrinter = require('pdfmake');
    console.log("PDF-motorn laddad framgångsrikt!");
} catch (err) {
    console.warn("Varning: 'pdfmake' saknas! Kör 'npm install pdfmake' i cPanel.");
}

const app = express();
// verify sparar undan råa request-bytes - krävs för att kunna signaturverifiera
// Facebooks webhook (X-Hub-Signature-256) mot den exakta body som skickades.
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const { createSession, deleteSession, purgeExpiredSessions, requireAuth, requireRole } = initSessions(db);
purgeExpiredSessions(); // rensa gamla sessioner vid serverstart, samma mönster som offert-papperskorgen
const requireStaff = requireRole('Superadmin', 'Admin', 'Säljare'); // "ej Montör"
const requireAdmin = requireRole('Superadmin', 'Admin');

// Enhetligt svar för enkla INSERT/UPDATE/DELETE-anrop: {message: string} med 500 vid db-fel,
// annars 200 med successMessage (och ev. extra fält, t.ex. { id: result.insertId }).
function dbResult(res, successMessage, extra) {
    return (err, result) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: successMessage, ...(extra ? extra(result) : {}) });
    };
}

// ANVÄNDARE & LEADS & KUNDER
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) return res.status(500).json({ message: 'Serverfel' });
        if (results.length > 0 && verifyPassword(password, results[0].password)) {
            const user = { id: results[0].id, name: results[0].name, role: results[0].role };
            createSession(user, (sessErr, token) => {
                if (sessErr) return res.status(500).json({ message: 'Kunde inte skapa session.' });
                res.json({ message: 'Inloggning lyckades', role: user.role, id: user.id, name: user.name, token });
            });
        } else res.status(401).json({ message: 'Fel e-post eller lösenord.' });
    });
});
app.post('/api/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body && req.body.token);
    if (!token) return res.json({ message: 'Utloggad.' });
    deleteSession(token, () => res.json({ message: 'Utloggad.' }));
});
app.get('/api/users', requireAuth, requireAdmin, (req, res) => db.query('SELECT id, name, email, role, order_range_start, order_range_end FROM users', (err, results) => res.json(results || [])));
app.get('/api/installers', requireAuth, (req, res) => db.query('SELECT id, name FROM users WHERE role = "Montör"', (err, results) => res.json(results || [])));
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
    const { name, email, password, role, order_range_start, order_range_end } = req.body;
    db.query('INSERT INTO users (name, email, password, role, order_range_start, order_range_end) VALUES (?, ?, ?, ?, ?, ?)', [name, email, hashPassword(password), role, order_range_start || null, order_range_end || null], dbResult(res, 'Användare skapad!'));
});
app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const { name, email, password, role, order_range_start, order_range_end } = req.body;
    if (password) {
        db.query('UPDATE users SET name=?, email=?, role=?, order_range_start=?, order_range_end=?, password=? WHERE id=?',
            [name, email, role, order_range_start || null, order_range_end || null, hashPassword(password), req.params.id],
            dbResult(res, 'Användare uppdaterad!'));
    } else {
        db.query('UPDATE users SET name=?, email=?, role=?, order_range_start=?, order_range_end=? WHERE id=?',
            [name, email, role, order_range_start || null, order_range_end || null, req.params.id],
            dbResult(res, 'Användare uppdaterad!'));
    }
});
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => db.query('DELETE FROM users WHERE id = ?', [req.params.id], dbResult(res, 'Borttagen')));

// Kända lead-fält matchas via nyckelord oavsett vad formulärverktyget döpt dem till.
// Fält som INTE matchar någon känd kategori tappas inte bort - de sparas i extra_data (JSON)
// så inget går förlorat även om formuläret har fält vi inte kände till i förväg.
const LEAD_FIELD_KEYWORDS = {
    name: ['name', 'namn', 'first_name'],
    email: ['email', 'epost', 'e-post'],
    phone: ['phone', 'tel', 'mobil'],
    kommun: ['kommun', 'city', 'ort']
};

function extractLeadFields(fieldsObj, valueOf) {
    const result = { name: '', email: '', phone: '', kommun: '' };
    const extra = {};
    for (let key in fieldsObj) {
        const k = key.toLowerCase();
        const value = valueOf(fieldsObj[key]);
        const category = Object.keys(LEAD_FIELD_KEYWORDS).find(cat => LEAD_FIELD_KEYWORDS[cat].some(kw => k.includes(kw)));
        if (category) { if (!result[category] && value) result[category] = value; }
        else if (value !== undefined && value !== null && value !== '') extra[key] = value;
    }
    return { ...result, extra };
}

function insertLead(fields, source, defaultName) {
    const { name, email, phone, kommun, extra } = fields;
    db.query('INSERT INTO leads (name, email, phone, kommun, source, extra_data) VALUES (?, ?, ?, ?, ?, ?)',
        [name || defaultName, email, phone, kommun, source, Object.keys(extra).length ? JSON.stringify(extra) : null], () => {});
}

app.post('/api/webhook/elementor/:token', (req, res) => {
    db.query('SELECT webhook_token FROM company_settings WHERE id = 1', (tokenErr, tokenRows) => {
        if (tokenErr || !tokenRows.length || !tokenRows[0].webhook_token || tokenRows[0].webhook_token !== req.params.token) {
            return res.status(403).send('Ogiltig eller saknad webhook-token.');
        }
        res.status(200).send("Webhook mottagen!");
        try {
            const source = req.body.fields || req.body;
            const valueOf = v => (v && v.value !== undefined) ? v.value : v;
            insertLead(extractLeadFields(source, valueOf), 'Elementor', 'Okänd Lead');
        } catch (error) {}
    });
});

// Facebook/Meta Lead Ads. Meta verifierar webhooken med ett GET-anrop (hub.challenge ska
// ekas tillbaka), och skickar sedan bara ett leadgen_id via POST - själva svarsdatan hämtas
// separat via Graph API med sidans access-token. Kräver uppgifter under Inställningar > Facebook.
const FB_GRAPH_VERSION = 'v21.0';

app.get('/api/webhook/facebook', (req, res) => {
    db.query('SELECT fb_verify_token FROM company_settings WHERE id = 1', (err, rows) => {
        const expected = rows && rows[0] ? rows[0].fb_verify_token : null;
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        if (!err && expected && mode === 'subscribe' && token === expected) {
            res.status(200).send(req.query['hub.challenge']);
        } else {
            res.sendStatus(403);
        }
    });
});

function verifyFacebookSignature(req, appSecret) {
    if (!appSecret) return true; // ingen app secret konfigurerad - signaturverifiering hoppas över
    const signature = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    try { return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
    catch (e) { return false; }
}

app.post('/api/webhook/facebook', (req, res) => {
    res.status(200).send('EVENT_RECEIVED'); // Meta kräver ett snabbt 200-svar - resten bearbetas i bakgrunden
    db.query('SELECT fb_page_access_token, fb_app_secret FROM company_settings WHERE id = 1', async (err, rows) => {
        const settings = rows && rows[0] ? rows[0] : {};
        if (err || !settings.fb_page_access_token) return;
        if (!verifyFacebookSignature(req, settings.fb_app_secret)) return;
        try {
            const entries = req.body.entry || [];
            for (const entry of entries) {
                for (const change of (entry.changes || [])) {
                    if (change.field !== 'leadgen' || !change.value || !change.value.leadgen_id) continue;
                    const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${change.value.leadgen_id}?access_token=${encodeURIComponent(settings.fb_page_access_token)}`;
                    const fbRes = await fetch(url);
                    const leadData = await fbRes.json();
                    if (!leadData || !Array.isArray(leadData.field_data)) continue;
                    const fieldsObj = {};
                    leadData.field_data.forEach(f => { fieldsObj[f.name] = (f.values && f.values[0]) || ''; });
                    insertLead(extractLeadFields(fieldsObj, v => v), 'Facebook', 'Okänd Lead (Facebook)');
                }
            }
        } catch (error) {}
    });
});

app.get('/api/leads', requireAuth, requireStaff, (req, res) => db.query("SELECT * FROM leads WHERE status = 'Ny' ORDER BY created_at DESC", (err, results) => res.json(results || [])));
app.post('/api/leads/:id/convert', requireAuth, requireStaff, (req, res) => {
    db.query('SELECT * FROM leads WHERE id = ?', [req.params.id], (err, leadsResults) => {
        if (err || !leadsResults || leadsResults.length === 0) return res.status(404).json({ message: 'Lead hittades inte' });
        const targetLead = leadsResults[0];
        const customerName = String(targetLead.name || 'Okänd Kund').trim();
        db.query('INSERT INTO customers (name, email, phone, address) VALUES (?, ?, ?, ?)', [customerName, targetLead.email||'', targetLead.phone||'', targetLead.kommun||''], (err, insertResult) => {
            if (err) return res.status(500).json({ message: 'Kunde inte skapa kund' });
            db.query("UPDATE leads SET status = 'Konverterad' WHERE id = ?", [req.params.id], () => res.json({ message: 'Lead har konverterats!', customerId: insertResult.insertId }));
        });
    });
});
app.delete('/api/leads/:id', requireAuth, requireStaff, (req, res) => db.query('DELETE FROM leads WHERE id = ?', [req.params.id], dbResult(res, 'Lead raderad')));

app.get('/api/customers', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM customers ORDER BY created_at DESC', (err, results) => res.json(results || [])));
app.post('/api/customers', requireAuth, requireStaff, (req, res) => {
    const { name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer } = req.body;
    db.query(`INSERT INTO customers (name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer], dbResult(res, 'Kund sparad!', result => ({ id: result.insertId })));
});
app.put('/api/customers/:id', requireAuth, requireStaff, (req, res) => {
    const { name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer } = req.body;
    db.query(`UPDATE customers SET name=?, address=?, address2=?, apartment_number=?, brf_org_nr=?, property_designation=?, email=?, phone=?, personnummer=? WHERE id=?`, [name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer, req.params.id], dbResult(res, 'Kund uppdaterad!'));
});
app.get('/api/customers/:id/quotes', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id], (err, results) => res.json(results || [])));

// ==========================================
// PRODUKTER (NU MED VARIANT-STÖD!)
// ==========================================
app.get('/api/products', requireAuth, requireStaff, (req, res) => db.query(
    `SELECT p.*, COALESCE(ft.front_layout, p.front_layout) AS effective_front_layout
     FROM products p
     LEFT JOIN frame_types ft ON p.frame_type_id = ft.id AND ft.active = 1
     ORDER BY p.id DESC`,
    (err, results) => res.json(results || [])
));

const uploadMiddleware = upload.fields([{ name: 'mainImage', maxCount: 1 }, { name: 'galleryImages', maxCount: 10 }]);

app.post('/api/products', requireAuth, requireAdmin, (req, res) => {
    uploadMiddleware(req, res, async function (err) {
        if (err) return res.status(400).json({ message: 'Uppladdningsfel' });
        const { id, name, description, sku, cc_measurement, height, length, width, brand, category, installation_price, installer_share, standard_price, purchase_price, supplier_id, frame_type_id, door_model_id, door_price_group_id, remove_main_image, retained_gallery, has_variations, variations } = req.body;
        // Tomt SKU sparas som NULL istället för '' - annars krockar flera produkter utan eget SKU
        // (t.ex. variantprodukter) mot den unika SKU-kolumnen.
        const skuValue = (sku && sku.trim() !== '') ? sku.trim() : null;
        const mainFile = req.files && req.files['mainImage'] ? req.files['mainImage'][0] : null;
        const galleryFiles = req.files && req.files['galleryImages'] ? req.files['galleryImages'] : [];

        // Hantera varianter (JSON)
        let finalVariations = '[]';
        if (has_variations === 'true' && variations) {
            try { finalVariations = variations; } catch(e) {}
        }

        if (id) {
            let finalGallery = [];
            try { finalGallery = JSON.parse(retained_gallery || '[]'); } catch(e) {}
            galleryFiles.forEach(f => finalGallery.push('/uploads/' + f.filename));

            // OBS: front_layout skrivs medvetet inte över här längre - stomtyper (frame_types) har
            // ersatt inline-konfiguration för nya/redigerade produkter. Gamla produkters front_layout
            // lämnas orört som legacy-fallback (se COALESCE i GET /api/products).
            let sql = `UPDATE products SET name=?, description=?, sku=?, cc_measurement=?, height=?, length=?, width=?, brand=?, category=?, installation_price=?, installer_share=?, standard_price=?, purchase_price=?, supplier_id=?, frame_type_id=?, door_model_id=?, door_price_group_id=?, gallery=?, has_variations=?, variations=?`;
            let params = [name, description, skuValue, cc_measurement, height||0, length||0, width||0, brand, category, installation_price||0, installer_share||0, standard_price||0, purchase_price||0, supplier_id || null, frame_type_id || null, door_model_id || null, door_price_group_id || null, JSON.stringify(finalGallery), has_variations === 'true' ? 1 : 0, finalVariations];

            if (remove_main_image === 'true') { sql += `, image_url=''`; }
            else if (mainFile) { sql += `, image_url=?`; params.push('/uploads/' + mainFile.filename); }

            sql += ` WHERE id=?`;
            params.push(id);
            db.query(sql, params, (err) => {
                if (err) return res.status(500).json({ message: 'Kunde inte uppdatera produkten: ' + err.message });
                res.json({ message: 'Uppdaterad!' });
            });
        } else {
            const finalMain = mainFile ? '/uploads/' + mainFile.filename : '';
            const finalGallery = galleryFiles.map(f => '/uploads/' + f.filename);
            const sql = `INSERT INTO products (name, description, sku, cc_measurement, height, length, width, brand, category, image_url, gallery, installation_price, installer_share, standard_price, purchase_price, supplier_id, frame_type_id, door_model_id, door_price_group_id, has_variations, variations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.query(sql, [name, description, skuValue, cc_measurement, height||0, length||0, width||0, brand, category, finalMain, JSON.stringify(finalGallery), installation_price||0, installer_share||0, standard_price||0, purchase_price||0, supplier_id || null, frame_type_id || null, door_model_id || null, door_price_group_id || null, has_variations === 'true' ? 1 : 0, finalVariations], (err) => {
                if (err) return res.status(500).json({ message: 'Kunde inte spara produkten: ' + err.message });
                res.json({ message: 'Sparad!' });
            });
        }
    });
});

// ==========================================
// STOMTYPER (frame_types) - återanvändbara frontkonfigurationer
// ==========================================
app.get('/api/frame-types', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM frame_types WHERE active = 1 ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/frame-types', requireAuth, requireAdmin, (req, res) => {
    const { name, front_layout } = req.body;
    db.query('INSERT INTO frame_types (name, front_layout) VALUES (?, ?)', [name, front_layout], dbResult(res, 'Stomtyp skapad!', result => ({ id: result.insertId })));
});
app.put('/api/frame-types/:id', requireAuth, requireAdmin, (req, res) => {
    const { name, front_layout, active } = req.body;
    db.query('UPDATE frame_types SET name=?, front_layout=?, active=? WHERE id=?', [name, front_layout, active === false || active === 'false' ? 0 : 1, req.params.id], dbResult(res, 'Stomtyp uppdaterad!'));
});
app.delete('/api/frame-types/:id', requireAuth, requireAdmin, (req, res) => db.query('UPDATE frame_types SET active = 0 WHERE id = ?', [req.params.id], dbResult(res, 'Stomtyp inaktiverad!')));

app.post('/api/products/bulk', requireAuth, requireAdmin, async (req, res) => {
    const products = req.body;
    if (!products || products.length === 0) return res.status(400).json({ message: 'Inga produkter skickades in.' });
    
    for (let p of products) {
        let localGallery = []; let mainImage = '';
        if (p.image_url && p.image_url.includes('http')) {
            const urls = p.image_url.split(',').map(u => u.trim()).filter(u => u.startsWith('http'));
            for (let i = 0; i < urls.length; i++) {
                const localPath = await downloadExternalImage(urls[i], uploadDir);
                if (localPath) { if (i === 0) mainImage = localPath; else localGallery.push(localPath); }
            }
        }
        p.image_url = mainImage; 
        p.gallery = JSON.stringify(localGallery);
        
        // Formatera varianterna till JSON
        if(typeof p.variations === 'object') p.variations = JSON.stringify(p.variations);
        else if(!p.variations) p.variations = '[]';
    }

    const values = products.map(p => [
        p.name, p.description, p.sku, p.cc_measurement||'', p.height||0, p.length||0, p.width||0, p.brand||'', p.category||'Okategoriserad', 
        p.image_url, p.gallery, p.installation_price||0, p.installer_share||0, p.standard_price||0, p.purchase_price||0, 
        p.has_variations ? 1 : 0, p.variations
    ]);
    
    const sql = `INSERT INTO products (name, description, sku, cc_measurement, height, length, width, brand, category, image_url, gallery, installation_price, installer_share, standard_price, purchase_price, has_variations, variations) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), standard_price=VALUES(standard_price), image_url=IF(VALUES(image_url) != '', VALUES(image_url), image_url), gallery=IF(VALUES(gallery) != '[]', VALUES(gallery), gallery), has_variations=VALUES(has_variations), variations=VALUES(variations)`;
    
    db.query(sql, [values], (err, result) => {
        if (err) return res.status(500).json({message: err.message});
        res.json({ message: `Smidigt! ${result.affectedRows} rader påverkades av importen.` });
    });
});

app.delete('/api/products/:id', requireAuth, requireAdmin, (req, res) => db.query('DELETE FROM products WHERE id = ?', [req.params.id], dbResult(res, 'Raderad!')));

// ==========================================
// RESTEN AV API:ER (BÄNKSKIVOR & OFFERTER - OFÖRÄNDRADE)
// ==========================================
app.get('/api/countertops/config', requireAuth, requireStaff, (req, res) => {
    db.query('SELECT * FROM countertop_materials', (err1, materials) => {
        db.query('SELECT * FROM countertop_colors', (err2, colors) => {
            db.query('SELECT * FROM countertop_prices', (err3, prices) => {
                db.query('SELECT * FROM countertop_services', (err4, services) => {
                    db.query('SELECT * FROM countertop_edges', (err5, edges) => {
                        db.query('SELECT * FROM countertop_price_groups', (err6, priceGroups) => {
                            res.json({ materials: materials||[], colors: colors||[], prices: prices||[], services: services||[], edges: edges||[], price_groups: priceGroups||[] });
                        });
                    });
                });
            });
        });
    });
});

// Prisgrupper (bänkskivor): material med use_price_groups=1 prissätter flera färger
// gemensamt genom att låta dem dela samma prisgrupp istället för egna prisrader.
// Egna endpoints (inte generiska ctTables-loopen) eftersom borttagning behöver städa
// upp kopplade prisrader och lösgöra färger, inte bara ta bort gruppraden.
app.post('/api/countertops/price_groups', requireAuth, requireAdmin, (req, res) => {
    const { name, material_id } = req.body;
    db.query('INSERT INTO countertop_price_groups (name, material_id) VALUES (?, ?)', [name, material_id], dbResult(res, 'Prisgrupp skapad!', result => ({ id: result.insertId })));
});
app.put('/api/countertops/price_groups/:id', requireAuth, requireAdmin, (req, res) => {
    db.query('UPDATE countertop_price_groups SET name = ? WHERE id = ?', [req.body.name, req.params.id], dbResult(res, 'Prisgrupp uppdaterad!'));
});
app.delete('/api/countertops/price_groups/:id', requireAuth, requireAdmin, (req, res) => {
    db.query('DELETE FROM countertop_prices WHERE price_group_id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        db.query('UPDATE countertop_colors SET price_group_id = NULL WHERE price_group_id = ?', [req.params.id], (err2) => {
            if (err2) return res.status(500).json({ message: err2.message });
            db.query('DELETE FROM countertop_price_groups WHERE id = ?', [req.params.id], dbResult(res, 'Prisgrupp raderad!'));
        });
    });
});
const ctTables = ['materials', 'colors', 'prices', 'services', 'edges'];
ctTables.forEach(table => {
    app.post(`/api/countertops/${table}`, requireAuth, requireAdmin, (req, res) => {
        if (table === 'prices' && req.body.color_ids) {
            const { depth_min, depth_max, price_per_lm, thickness, color_ids } = req.body;
            if (!color_ids || color_ids.length === 0) return res.status(400).json({ message: "Inga färger angivna" });
            const values = color_ids.map(id => [id, depth_min, depth_max, price_per_lm, thickness]);
            db.query(`INSERT INTO countertop_prices (color_id, depth_min, depth_max, price_per_lm, thickness) VALUES ?`, [values], (err) => {
                if (err) return res.status(500).json({ message: err.message });
                res.json({ message: 'Priserna har sparats på alla valda färger!' });
            });
        } else db.query(`INSERT INTO countertop_${table} SET ?`, req.body, (err, result) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: 'Sparad', id: result.insertId });
        });
    });
    app.put(`/api/countertops/${table}/:id`, requireAuth, requireAdmin, (req, res) => db.query(`UPDATE countertop_${table} SET ? WHERE id = ?`, [req.body, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: 'Uppdaterad' });
    }));
    app.delete(`/api/countertops/${table}/:id`, requireAuth, requireAdmin, (req, res) => db.query(`DELETE FROM countertop_${table} WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: 'Raderad' });
    }));
});

// Snabbinmatning: godtycklig blandning av rader (olika färger/tjocklekar/djup) i ett enda anrop,
// för att slippa öppna en modal per rad när ett helt prisunderlag matas in manuellt.
app.post('/api/countertops/prices/bulk', requireAuth, requireAdmin, (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: 'Inga rader skickades in.' });
    const values = rows.map(r => [r.color_id || null, r.price_group_id || null, r.depth_min || 0, r.depth_max || 0, r.price_per_lm || 0, r.thickness || 0]);
    db.query('INSERT INTO countertop_prices (color_id, price_group_id, depth_min, depth_max, price_per_lm, thickness) VALUES ?', [values], (err, result) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: `${result.affectedRows} prisrader sparade!` });
    });
});

app.post('/api/countertops/colors/:id/image', requireAuth, requireAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Ingen bildfil mottagen' });
    db.query('UPDATE countertop_colors SET image_url = ? WHERE id = ?', ['/uploads/' + req.file.filename, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: 'Bild uppladdad!' });
    });
});

app.get('/api/quotes', requireAuth, requireStaff, (req, res) => db.query(`SELECT q.*, c.name as customer_name, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.status != 'Order' AND q.deleted_at IS NULL ORDER BY q.created_at DESC`, (err, results) => res.json(results || [])));
app.get('/api/orders', requireAuth, (req, res) => {
    const installerId = req.query.installer_id;
    db.query(`SELECT q.*, c.name as customer_name, c.address, c.phone, c.email, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.status = 'Order' AND q.deleted_at IS NULL ORDER BY q.created_at DESC`, installerId ? [installerId] : [], (err, results) => res.json(results || []));
});

// ==========================================
// PAPPERSKORG FÖR OFFERTER (mjuk borttagning, auto-rensning efter 10 dagar)
// ==========================================
const TRASH_RETENTION_DAYS = 10;
function purgeExpiredQuotes(callback) {
    db.query('DELETE FROM quotes WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [TRASH_RETENTION_DAYS], (err) => { if (callback) callback(err); });
}
purgeExpiredQuotes(); // rensa gamla papperskorgs-rader vid serverstart

app.delete('/api/quotes/:id', requireAuth, requireStaff, (req, res) => db.query('UPDATE quotes SET deleted_at = NOW() WHERE id = ?', [req.params.id], dbResult(res, 'Offerten flyttad till papperskorgen.')));
app.put('/api/quotes/:id/restore', requireAuth, requireStaff, (req, res) => db.query('UPDATE quotes SET deleted_at = NULL WHERE id = ?', [req.params.id], dbResult(res, 'Offerten återställd!')));
app.delete('/api/quotes/:id/permanent', requireAuth, requireStaff, (req, res) => db.query('DELETE FROM quotes WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id], dbResult(res, 'Raderad permanent.')));
app.get('/api/quotes/trash', requireAuth, requireStaff, (req, res) => {
    purgeExpiredQuotes(() => {
        db.query(`SELECT q.*, c.name as customer_name FROM quotes q JOIN customers c ON q.customer_id = c.id WHERE q.deleted_at IS NOT NULL ORDER BY q.deleted_at DESC`, (err, results) => res.json(results || []));
    });
});
app.get('/api/quotes/:id', requireAuth, requireStaff, (req, res) => db.query('SELECT q.*, c.name as customer_name, c.address, c.address2, c.apartment_number, c.brf_org_nr, c.property_designation, c.email, c.phone, c.personnummer FROM quotes q JOIN customers c ON q.customer_id = c.id WHERE q.id = ?', [req.params.id], (err, results) => res.json(results && results.length > 0 ? results[0] : null)));
app.post('/api/quotes', requireAuth, requireStaff, (req, res) => db.query('INSERT INTO quotes (customer_id, quote_name, status) VALUES (?, ?, "Utkast")', [req.body.customer_id, req.body.quote_name], dbResult(res, 'Offert skapad!', result => ({ quoteId: result.insertId }))));
app.put('/api/quotes/:id/status', requireAuth, requireStaff, (req, res) => {
    const { status, installer_id } = req.body; const quoteId = req.params.id;
    if (status === 'Order') {
        db.query('SELECT order_number FROM quotes WHERE id = ?', [quoteId], (err, results) => {
            if (results && results[0] && results[0].order_number) db.query('UPDATE quotes SET status = ?, installer_id = ? WHERE id = ?', [status, installer_id || null, quoteId], () => res.json({message: 'Uppdaterad!'}));
            else {
                db.query('SELECT order_range_start, order_range_end FROM users WHERE id = ?', [req.user.id], (userErr, userRows) => {
                    const configured = userRows && userRows[0] && userRows[0].order_range_start != null && userRows[0].order_range_end != null;
                    const assignOrderNumber = (maxRes, fallback) => {
                        const newOrderNumber = maxRes && maxRes[0].max_num ? maxRes[0].max_num + 1 : fallback;
                        db.query('UPDATE quotes SET status = ?, installer_id = ?, order_number = ? WHERE id = ?', [status, installer_id || null, newOrderNumber, quoteId], () => res.json({message: `Order skapad med ordernummer #${newOrderNumber}!`}));
                    };
                    if (configured) {
                        const minRange = userRows[0].order_range_start, maxRange = userRows[0].order_range_end;
                        db.query('SELECT MAX(order_number) as max_num FROM quotes WHERE order_number >= ? AND order_number <= ?', [minRange, maxRange], (err2, maxRes) => assignOrderNumber(maxRes, minRange));
                    } else {
                        db.query('SELECT MAX(order_number) as max_num FROM quotes', (err2, maxRes) => assignOrderNumber(maxRes, 1000));
                    }
                });
            }
        });
    } else db.query('UPDATE quotes SET status = ?, installer_id = ? WHERE id = ?', [status, installer_id || null, quoteId], () => res.json({message: 'Uppdaterad!'}));
});
app.put('/api/quotes/:id', requireAuth, requireStaff, (req, res) => {
    const { quoteCart, selectedConditions, kitchenSpecs, extraFees, globalDiscount, discountType, useRot, internal_comment, public_comment, coverPage } = req.body;
    db.query('UPDATE quotes SET global_discount = ?, discount_type = ?, quote_data = ?, internal_comment = ?, public_comment = ? WHERE id = ?',
        [globalDiscount || 0, discountType || '%', JSON.stringify({ selectedConditions, kitchenSpecs, extraFees, quoteCart, useRot, coverPage }), internal_comment || null, public_comment || null, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Fel vid sparning." });
        db.query('DELETE FROM quote_items WHERE quote_id = ?', [req.params.id], () => {
            if (!quoteCart || quoteCart.length === 0) return res.json({ message: 'Offerten har sparats.' });
            const values = quoteCart.map(i => [req.params.id, i.id || null, i.sku, i.name, i.priceIncVat, i.installIncVat, i.qty, i.isFreeText ? 1 : 0]);
            db.query('INSERT INTO quote_items (quote_id, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text) VALUES ?', [values], () => res.json({ message: 'Offerten har sparats framgångsrikt!' }));
        });
    });
});
// Laddar upp en bild till offertens försättsblad (hero/handtag/modell/färg). Filen sparas
// bara på disk och URL:en returneras - själva kopplingen till vilken offert/vilket "slot"
// den hör till sparas i quotes.quote_data.coverPage via den vanliga auto-spara-PUT:en.
app.post('/api/quotes/:id/cover-image', requireAuth, requireStaff, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Ingen bild bifogad.' });
    res.json({ url: '/uploads/' + req.file.filename });
});
app.post('/api/quotes/:id/duplicate', requireAuth, requireStaff, (req, res) => {
    db.query('SELECT * FROM quotes WHERE id = ?', [req.params.id], (err, quoteResults) => {
        if (err) return res.status(500).json({ message: err.message });
        if (!quoteResults || quoteResults.length === 0) return res.status(404).json({ message: 'Offerten hittades inte' });
        const o = quoteResults[0];
        db.query('INSERT INTO quotes (customer_id, quote_name, status, quote_data, global_discount, discount_type, internal_comment, public_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [o.customer_id, o.quote_name + ' (Kopia)', 'Utkast', o.quote_data, o.global_discount, o.discount_type, o.internal_comment, o.public_comment], (err2, newQuoteResult) => {
            if (err2) return res.status(500).json({ message: err2.message });
            db.query('INSERT INTO quote_items (quote_id, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text) SELECT ?, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text FROM quote_items WHERE quote_id = ?', [newQuoteResult.insertId, req.params.id], dbResult(res, 'Duplicerad!'));
        });
    });
});
app.put('/api/orders/:id/comments', requireAuth, (req, res) => db.query('UPDATE quotes SET internal_comment = ?, public_comment = ? WHERE id = ?', [req.body.internal_comment || null, req.body.public_comment || null, req.params.id], dbResult(res, 'Kommentarer sparade!')));
app.get('/api/orders/:id/files', requireAuth, (req, res) => db.query('SELECT * FROM order_files WHERE quote_id = ? ORDER BY created_at DESC', [req.params.id], (err, results) => res.json(results || [])));
app.post('/api/orders/:id/files', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Ingen fil mottagen' });
    const fileType = ['.jpg', '.jpeg', '.png', '.heic', '.gif'].includes(path.extname(req.file.originalname).toLowerCase()) ? 'image' : 'document';
    db.query('INSERT INTO order_files (quote_id, file_name, file_url, file_type, uploaded_by) VALUES (?,?,?,?,?)', [req.params.id, req.file.originalname, '/uploads/' + req.file.filename, fileType, req.body.user_id || null], dbResult(res, 'Fil uppladdad!'));
});
// ==========================================
// STÄDA OANVÄNDA UPPLADDNINGAR (public/uploads)
// ==========================================
// Ingenting raderas automatiskt av sig själv. En raderad produkt/bänkskivefärg/offert
// lämnar kvar sin uppladdade bildfil på disk (ingen kod rensar den idag), och listan växer
// därför långsamt över tid. Detta är ett medvetet tvåstegsverktyg: /scan returnerar bara en
// lista att granska, /cleanup raderar bara EXAKT de filnamn admin bekräftat - och
// återverifierar varje filnamn mot databasen precis innan radering (aldrig admins lista blint),
// samt hoppar alltid över filer nyare än 15 minuter för att aldrig träffa en fil som just
// laddats upp men vars databaspost inte hunnit sparas än (t.ex. försättsbladsbilder som
// laddas upp direkt men bara kopplas till offerten vid nästa auto-spara).
const dbP = db.promise();
async function findOrphanedUploads() {
    const [[companyRow], products, colors, quotes, orderFiles] = await Promise.all([
        dbP.query('SELECT logo_url FROM company_settings WHERE id = 1').then(r => r[0]),
        dbP.query('SELECT image_url, gallery FROM products').then(r => r[0]),
        dbP.query('SELECT image_url FROM countertop_colors').then(r => r[0]),
        dbP.query('SELECT quote_data FROM quotes').then(r => r[0]),
        dbP.query('SELECT file_url FROM order_files').then(r => r[0])
    ]);
    const referenced = new Set();
    const addUrl = (u) => { if (u && typeof u === 'string' && u.includes('/uploads/')) referenced.add(path.basename(u.split('?')[0])); };
    addUrl(companyRow && companyRow.logo_url);
    products.forEach(p => {
        addUrl(p.image_url);
        // gallery är en JSON-kolumn - kan komma redan uppackad som en array istället för en
        // sträng (samma mönster som quote_data). Ett blint JSON.parse() hade annars kunnat
        // missa bilder i galleriet och göra dem felaktigt flaggade som oanvända.
        try {
            const gallery = typeof p.gallery === 'string' ? JSON.parse(p.gallery || '[]') : (p.gallery || []);
            (gallery || []).forEach(addUrl);
        } catch (e) {}
    });
    colors.forEach(c => addUrl(c.image_url));
    orderFiles.forEach(f => addUrl(f.file_url));
    quotes.forEach(q => {
        if (!q.quote_data) return;
        // quote_data är en JSON-kolumn - kan komma som ett redan uppackat objekt istället för
        // en sträng, samma som i PDF-genereringen ovan. Stränga alltid till text innan regex-sök.
        const text = typeof q.quote_data === 'string' ? q.quote_data : JSON.stringify(q.quote_data);
        const matches = text.match(/\/uploads\/[a-zA-Z0-9._-]+/g);
        if (matches) matches.forEach(addUrl);
    });

    const files = fs.readdirSync(uploadDir);
    const now = Date.now();
    const SAFETY_MS = 15 * 60 * 1000;
    return files
        .filter(filename => !referenced.has(filename))
        .map(filename => {
            const stat = fs.statSync(path.join(uploadDir, filename));
            return { filename, url: '/uploads/' + filename, size: stat.size, mtime: stat.mtime, tooRecent: (now - stat.mtimeMs) < SAFETY_MS };
        })
        .sort((a, b) => a.mtime - b.mtime);
}

app.get('/api/maintenance/uploads-scan', requireAuth, requireAdmin, async (req, res) => {
    try {
        const orphaned = await findOrphanedUploads();
        res.json({ orphaned });
    } catch (e) { res.status(500).json({ message: 'Kunde inte skanna uppladdningar: ' + e.message }); }
});

app.post('/api/maintenance/uploads-cleanup', requireAuth, requireAdmin, async (req, res) => {
    const requested = Array.isArray(req.body.filenames) ? req.body.filenames : [];
    if (requested.length === 0) return res.status(400).json({ message: 'Inga filer valda.' });
    try {
        // Skannar på nytt precis innan radering - listan admin klickade på kan vara några
        // sekunder gammal, och en fil kan under tiden ha blivit kopplad till något (eller
        // inte längre finnas). Raderar aldrig något som inte klarar en färsk kontroll.
        const freshOrphaned = await findOrphanedUploads();
        const stillOrphaned = new Set(freshOrphaned.filter(f => !f.tooRecent).map(f => f.filename));
        const deleted = []; const skipped = [];
        requested.forEach(filename => {
            const safe = path.basename(filename);
            if (safe !== filename || !stillOrphaned.has(filename)) { skipped.push(filename); return; }
            try { fs.unlinkSync(path.join(uploadDir, filename)); deleted.push(filename); }
            catch (e) { skipped.push(filename); }
        });
        res.json({ message: `${deleted.length} fil(er) raderade${skipped.length ? `, ${skipped.length} hoppades över` : ''}.`, deleted, skipped });
    } catch (e) { res.status(500).json({ message: 'Kunde inte rensa uppladdningar: ' + e.message }); }
});

app.delete('/api/orders/files/:fileId', requireAuth, (req, res) => {
    db.query('SELECT file_url FROM order_files WHERE id = ?', [req.params.fileId], (err, results) => {
        if (err) return res.status(500).json({ message: err.message });
        if(results && results.length > 0) db.query('DELETE FROM order_files WHERE id = ?', [req.params.fileId], (err2) => {
            if (err2) return res.status(500).json({ message: err2.message });
            fs.unlink(path.join(__dirname, 'public', results[0].file_url), () => res.json({ message: 'Raderad' }));
        });
        else res.json({message: 'Redan raderad'});
    });
});
app.get('/api/orders/:id/assembly', requireAuth, (req, res) => {
    db.query('SELECT q.*, c.name as customer_name, c.address, c.phone, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.id = ?', [req.params.id], (err, quoteRes) => {
        db.query('SELECT id, sku, name, is_delivered, is_packed, is_assembled, assembly_comment FROM quote_items WHERE quote_id = ? AND is_free_text = 0', [req.params.id], (err, itemsRes) => res.json({ quote: quoteRes[0], items: itemsRes || [] }));
    });
});
app.put('/api/orders/:id/assembly/status', requireAuth, (req, res) => db.query(`UPDATE quotes SET factory_date = ?, assembly_start_date = ?, assembly_completed_date = ?, assembly_status = ? WHERE id = ?`, [req.body.factory_date || null, req.body.assembly_start_date || null, req.body.assembly_completed_date || null, req.body.assembly_status || 'Ej påbörjad', req.params.id], dbResult(res, 'Sparat!')));
app.put('/api/orders/assembly/item/:itemId', requireAuth, (req, res) => db.query(`UPDATE quote_items SET is_delivered = ?, is_packed = ?, is_assembled = ?, assembly_comment = ? WHERE id = ?`, [req.body.is_delivered ? 1 : 0, req.body.is_packed ? 1 : 0, req.body.is_assembled ? 1 : 0, req.body.assembly_comment, req.params.itemId], dbResult(res, 'Sparat!')));
// requireStaff (inte requireAdmin) - dashboard.html (startsidan) visas för alla utom Montör
// och anropar dessa statistik-endpoints, inte bara den admin-gated statistics.html-sidan.
app.get('/api/statistics', requireAuth, requireStaff, (req, res) => db.query('SELECT category, COUNT(*) as count FROM products GROUP BY category', (err, results) => res.json({ categories: results && results.length > 0 ? results : [{ category: 'Inga', count: 0 }] })));

// Riktig försäljningsstatistik (bäst säljande produkter/kategorier, ordersantal per månad).
// Filtreras på quotes.status='Order' (vunna ordrar) och valfritt datumintervall på quotes.created_at
// (offertens skapandedatum - det finns ingen separat "blev vunnen"-tidsstämpel i schemat).
// Fria textrader/bänkskivor/auto-fronter (utan riktigt product_id) räknas inte in i produkt-/kategoristatistiken.
app.get('/api/statistics/overview', requireAuth, requireStaff, (req, res) => {
    const { from, to } = req.query;
    let dateFilter = ''; const dateParams = [];
    if (from) { dateFilter += ' AND q.created_at >= ?'; dateParams.push(from); }
    if (to) { dateFilter += ' AND q.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; dateParams.push(to); }

    db.query(`SELECT COUNT(*) as c FROM quotes q WHERE q.status = 'Order'${dateFilter}`, dateParams, (err1, orderCountRows) => {
        const orderCount = (!err1 && orderCountRows[0]) ? orderCountRows[0].c : 0;
        db.query(`SELECT DATE_FORMAT(q.created_at, '%Y-%m') as month, COUNT(*) as count FROM quotes q WHERE q.status = 'Order'${dateFilter} GROUP BY month ORDER BY month ASC`, dateParams, (err2, monthRows) => {
            const ordersByMonth = err2 ? [] : monthRows;
            const itemJoinFilter = `q.status = 'Order' AND qi.is_free_text = 0 AND qi.product_id IS NOT NULL${dateFilter}`;
            db.query(`SELECT qi.product_id, p.name, p.sku, SUM(qi.qty) as qty, SUM(qi.price_inc_vat * qi.qty) as revenue
                       FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id JOIN products p ON qi.product_id = p.id
                       WHERE ${itemJoinFilter} GROUP BY qi.product_id, p.name, p.sku ORDER BY revenue DESC LIMIT 10`, dateParams, (err3, productRows) => {
                const topProducts = err3 ? [] : productRows;
                db.query(`SELECT p.category, SUM(qi.qty) as qty, SUM(qi.price_inc_vat * qi.qty) as revenue
                           FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id JOIN products p ON qi.product_id = p.id
                           WHERE ${itemJoinFilter} GROUP BY p.category ORDER BY revenue DESC`, dateParams, (err4, catRows) => {
                    const topCategories = err4 ? [] : catRows;
                    res.json({ range: { from: from || null, to: to || null }, orderCount, ordersByMonth, topProducts, topCategories });
                });
            });
        });
    });
});

// "Roliga siffror" för dashboarden - kul, lätt smält statistik (heltid, inget datumfilter).
// Total intäkt räknar in ALLA rader (även fritext/bänkskivor/tjänster) till skillnad från topProducts/topCategories ovan,
// eftersom det här ska spegla verklig total omsättning, inte per-produkt-attribution.
app.get('/api/statistics/fun-facts', requireAuth, requireStaff, (req, res) => {
    db.query(`SELECT SUM(qi.price_inc_vat * qi.qty) as total FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id WHERE q.status = 'Order'`, (e1, r1) => {
        const totalRevenue = (r1 && r1[0] && r1[0].total) ? r1[0].total : 0;
        db.query(`SELECT SUM(qi.price_inc_vat * qi.qty) as total FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id WHERE q.status = 'Order' AND YEAR(q.created_at) = YEAR(NOW())`, (eYear, rYear) => {
            const yearRevenue = (rYear && rYear[0] && rYear[0].total) ? rYear[0].total : 0;
            db.query(`SELECT q.id, q.quote_name, c.name as customer_name, SUM(qi.price_inc_vat * qi.qty) as total
                   FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id JOIN customers c ON q.customer_id = c.id
                   WHERE q.status = 'Order' GROUP BY q.id, q.quote_name, c.name ORDER BY total DESC LIMIT 1`, (e2, r2) => {
            const biggestOrder = (r2 && r2[0]) ? r2[0] : null;
            db.query(`SELECT COUNT(*) as c FROM quotes WHERE status = 'Order' AND deleted_at IS NULL`, (e3, r3) => {
                const orderCount = (r3 && r3[0]) ? r3[0].c : 0;
                db.query(`SELECT COUNT(*) as c FROM quotes WHERE status IN ('Offert', 'Order') AND deleted_at IS NULL`, (e4, r4) => {
                    const sentCount = (r4 && r4[0]) ? r4[0].c : 0;
                    const winRate = sentCount > 0 ? Math.round((orderCount / sentCount) * 100) : 0;
                    db.query(`SELECT COUNT(*) as c FROM leads WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, (e5, r5) => {
                        const newLeads30d = (r5 && r5[0]) ? r5[0].c : 0;
                        db.query(`SELECT kommun, COUNT(*) as c FROM leads WHERE kommun IS NOT NULL AND kommun != '' GROUP BY kommun ORDER BY c DESC LIMIT 1`, (e6, r6) => {
                            const topKommun = (r6 && r6[0]) ? r6[0] : null;
                            res.json({ totalRevenue, yearRevenue, biggestOrder, orderCount, sentCount, winRate, newLeads30d, topKommun });
                        });
                    });
                });
            });
        });
        });
    });
});

// PDF GENERATORS BEHÅLLS INTAKTA (Förkortade kommentarer)
app.get('/api/quotes/:id/pdf', requireAuth, (req, res) => {
    if (!PdfPrinter) return res.status(500).send("PDF-motorn saknas!");
    const fonts = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } };
    const printer = new PdfPrinter(fonts);
    db.query('SELECT q.*, c.name as customer_name, c.address, c.address2, c.apartment_number, c.brf_org_nr, c.property_designation, c.email, c.phone, c.personnummer FROM quotes q JOIN customers c ON q.customer_id = c.id WHERE q.id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Hittades inte');
        const order = results[0];
        let cart = []; let specs = {}; let selectedConditions = {}; let extraFees = {}; let useRot = true; let coverPage = null;
        // quote_data är en JSON-kolumn i MySQL - mysql2 packar redan upp den till ett objekt
        // automatiskt vid SELECT (den är ALDRIG en rå sträng här), så ett blint JSON.parse()
        // kastar tyst ett fel som fångas av catch(e){} och lämnar allt vid sina tomma
        // standardvärden. Samma buggmönster som redan fixades på klientsidan tidigare
        // (parseJsonField) - hanterar nu båda formaten även här på serversidan.
        if (order.quote_data) {
            try {
                const parsed = typeof order.quote_data === 'string' ? JSON.parse(order.quote_data) : order.quote_data;
                if (parsed.quoteCart) cart = parsed.quoteCart; if (parsed.kitchenSpecs) specs = parsed.kitchenSpecs; if (parsed.selectedConditions) selectedConditions = parsed.selectedConditions; if (parsed.extraFees) extraFees = parsed.extraFees; if (parsed.useRot !== undefined) useRot = parsed.useRot; if (parsed.coverPage) coverPage = parsed.coverPage;
            } catch(e) {}
        }
        const isOrder = order.status === 'Order'; const docTitle = isOrder ? 'KÖPEAVTAL' : 'OFFERT'; const dateStr = new Date(order.created_at).toLocaleDateString('sv-SE');

        db.query('SELECT * FROM company_settings WHERE id = 1', (err0, companyRes) => {
            const company = companyRes && companyRes.length > 0 ? companyRes[0] : {};
            if (!company.company_name || !company.logo_url) {
                return res.status(400).send('Företagsinformation saknas. Fyll i företagsnamn och ladda upp en logga under Företagsinfo innan du skapar PDF-dokument.');
            }
            const companyName = company.company_name;
            let headerLeftBlock = { text: companyName, fontSize: 24, bold: true, color: '#000000' };
            const logoPath = path.join(__dirname, 'public', company.logo_url.replace(/^\/?(public\/)?/, ''));
            if (fs.existsSync(logoPath)) { const ext = path.extname(logoPath).toLowerCase(); const mime = ext === '.png' ? 'image/png' : 'image/jpeg'; headerLeftBlock = { image: `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`, width: 140 }; }
            let ytbehandling = extraFees.colorSelect || '-'; if (extraFees.colorSelect === 'Valfri NCS-kod' && extraFees.colorCustom) ytbehandling = `NCS: ${extraFees.colorCustom}`;
            // OFFERT ska kännas säljande (färg, större bilder, framhävd totalsumma) medan
            // KÖPEAVTAL avsiktligt behåller sitt nuktrala, avtalsmässiga utseende oförändrat.
            // Färgerna är konfigurerbara under Företagsinfo (hämtade från loggan som standard).
            const accentColor = company.pdf_color_primary || '#2E5339';
            const goldColor = company.pdf_color_accent || '#E8A33D';
            const thStyle = isOrder ? 'th' : 'thOffer';
            const imgSize = isOrder ? 45 : 68;
            const tableBody = [ [{ text: '', style: thStyle, alignment: 'center' }, { text: 'Artikel / Beskrivning', style: thStyle }, { text: 'Antal', style: thStyle, alignment: 'center' }] ];
        
        db.query('SELECT id, sku, image_url FROM products', async (err, dbProducts) => {
            if (err) dbProducts = [];
        db.query('SELECT id, image_url FROM countertop_colors', async (errCol, dbColors) => {
            if (errCol) dbColors = [];
            // Hela PDF-uppbyggnaden (produkttabell, försättsblad, docDefinition) körs skyddad -
            // annars kraschar ett oväntat fel här (t.ex. en trasig/för stor uppladdad bild) tyst
            // hela Node-processen (unhandled rejection i en async db.query-callback som ingen
            // fångar upp), vilket visar sig som ett obegripligt 503 istället för ett läsbart fel.
            try {
            let totalMaterialBeforeGlobalDiscount = 0;
            for (let item of cart) {
                const rowMaterialTotal = (item.priceIncVat * (1 - (item.discount / 100))) * item.qty; totalMaterialBeforeGlobalDiscount += rowMaterialTotal;
                let pdfImageCell;
                if (item.colorId) {
                    const dbColor = dbColors.find(c => c.id == item.colorId);
                    pdfImageCell = await buildPdfImageCell(dbColor ? dbColor.image_url : null, imgSize);
                } else {
                    const dbProd = dbProducts.find(p => p.sku === item.sku || p.id == item.id);
                    pdfImageCell = await buildPdfImageCell(dbProd ? dbProd.image_url : null, imgSize);
                }
                tableBody.push([ pdfImageCell, [{ text: item.name, bold: true, color: '#000000', margin: [0, 5] }, { text: `Art.nr: ${item.sku}`, fontSize: 8, color: '#444444' }], { text: item.qty.toString(), alignment: 'center', margin: [0, 15], color: '#000000' } ]);
            }

            const conditionsList = [ { id: 'demontering_luckor', label: 'Demontering luckbyte', hasQty: false, price: 2000, isRot: true }, { id: 'demontering_helkok', label: 'Demontering helkök per stomme', hasQty: true, price: 600, isRot: true }, { id: 'bortforsling', label: 'Bortforsling', hasQty: false, price: 2000, isRot: false }, { id: 'bortforsling_vit', label: 'Bortforsling av vitvaror (vid köp av nya)', hasQty: true, price: 1000, isRot: false }, { id: 'inkoppling_vit', label: 'Inkoppling av vitvaror', hasQty: true, price: 1000, isRot: true }, { id: 'el', label: 'In/Urkoppling el', hasQty: false, hasCustomPrice: true, price: 0, isRot: true }, { id: 'vvs', label: 'In/Urkoppling VVS', hasQty: false, hasCustomPrice: true, price: 0, isRot: true } ];
            let totalRotInstallIncVat = 0; let totalNonRotInstallIncVat = 0;
            conditionsList.forEach(cond => {
                const current = selectedConditions[cond.id];
                if (current && current.responsibility === 'Klarälvskök') {
                    const qty = cond.hasQty ? (current.qty || 1) : 1; const unitPrice = cond.hasCustomPrice ? (parseFloat(current.customPrice) || 0) : cond.price; const rowTotal = unitPrice * qty;
                    if (cond.isRot) totalRotInstallIncVat += rowTotal; else totalNonRotInstallIncVat += rowTotal;
                    tableBody.push([ { text: '', alignment: 'center' }, { text: `Arbete: ${cond.label}`, bold: true, color: '#000000', margin: [0, 5] }, { text: qty.toString(), alignment: 'center', margin: [0, 5], color: '#000000' } ]);
                }
            });

            const startFeeProduct = parseFloat(extraFees.startFeeProduct) || 0;
            const startFeeNonRot = parseFloat(extraFees.startFeeNonRot) || 0;
            const startFeeRotComp = parseFloat(extraFees.startFeeRotComp) || 0; const startFeeRotInst = parseFloat(extraFees.startFeeRotInst) || 0; const colorFee = parseFloat(extraFees.feeColor) || 0;
            totalMaterialBeforeGlobalDiscount += startFeeProduct + colorFee; totalNonRotInstallIncVat += startFeeNonRot; totalRotInstallIncVat += (startFeeRotComp + startFeeRotInst);
            const globalDiscountVal = parseFloat(order.global_discount) || 0; const globalDiscountType = order.discount_type || '%';
            let globalDiscountAmount = globalDiscountType === '%' ? totalMaterialBeforeGlobalDiscount * (globalDiscountVal / 100) : globalDiscountVal;
            let totalMaterialIncVat = Math.max(0, totalMaterialBeforeGlobalDiscount - globalDiscountAmount);
            const rotDeduction = useRot ? (totalRotInstallIncVat * 0.30) : 0; const totalAssemblyCost = totalRotInstallIncVat + totalNonRotInstallIncVat; const finalToPay = totalMaterialIncVat + totalAssemblyCost - rotDeduction;

            // Totalsumma-raderna: på köpeavtalet visas "Totalt att betala" som sista raden i
            // den vanliga tabellen precis som förut. På offerten lyfts den istället ut som en
            // egen färgad totalsumma-banner nedanför, så tabellen slutar på "Summa montering...".
            const totalsRows = [
                [ { text: 'Produktkostnad innan rabatt:', color: '#000000' }, { text: totalMaterialBeforeGlobalDiscount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', alignment: 'right', color: '#000000' } ],
                [ { text: 'Rabatt:', color: '#000000' }, { text: `- ${globalDiscountAmount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`, alignment: 'right', color: '#000000' } ],
                [ { text: 'Summa produktkostnad:', bold: true, color: '#000000' }, { text: totalMaterialIncVat.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', alignment: 'right', bold: true, color: '#000000' } ],
                [ { text: 'Rot-berättigad monteringskostnad:', color: '#000000' }, { text: totalRotInstallIncVat.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', alignment: 'right', color: '#000000' } ],
                [ { text: 'ROT-avdrag (30%):', color: '#000000' }, { text: useRot ? `- ${rotDeduction.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr` : '0 kr', alignment: 'right', color: '#000000' } ],
                [ { text: 'Summa montering efter rotavdrag:', bold: true, color: '#000000' }, { text: (totalAssemblyCost - rotDeduction).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', alignment: 'right', bold: true, color: '#000000' } ]
            ];
            if (isOrder) totalsRows.push([ { text: 'Totalt att betala:', fontSize: 12, bold: true, color: '#000000' }, { text: finalToPay.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', fontSize: 12, bold: true, alignment: 'right', color: '#000000' } ]);

            // Valfritt försättsblad, bara för OFFERT: stor logga, en säljande rubrik, en
            // hero-bild (t.ex. ritningen på köket) och en rad med bilder på handtag/modell/
            // bänkskiva/färg. Bänkskivans bild hämtas automatiskt från vald bänkskivefärg i
            // korgen - övriga tre laddas upp manuellt av säljaren i offertbyggaren.
            let coverPageContent = [];
            if (!isOrder && coverPage && coverPage.enabled) {
                const coverLogoBlock = headerLeftBlock.image ? { image: headerLeftBlock.image, width: 260, alignment: 'center' } : { text: companyName, fontSize: 34, bold: true, color: accentColor, alignment: 'center' };
                const heroBlock = await buildPdfHeroImageBlock(coverPage.heroImage, 480, 300);
                const handleCell = await buildPdfImageCell(coverPage.handleImage, 90);
                const modelCell = await buildPdfImageCell(coverPage.modelImage, 90);
                const colorCell = await buildPdfImageCell(coverPage.colorImage, 90);
                const countertopItem = cart.find(i => i.colorId);
                const autoCountertopUrl = countertopItem ? (dbColors.find(c => c.id == countertopItem.colorId) || {}).image_url : null;
                const countertopCell = await buildPdfImageCell(autoCountertopUrl, 90);

                const galleryCol = (cell, label) => ({ width: '*', stack: [ (cell && cell.image) ? cell : { text: 'Bild saknas', italics: true, color: '#aaaaaa', fontSize: 8, alignment: 'center', margin: [0, 35, 0, 35] }, { text: label, alignment: 'center', fontSize: 9, bold: true, color: '#444444', margin: [0, 4, 0, 0] } ] });

                coverPageContent = [
                    { text: '', margin: [0, 30, 0, 0] },
                    coverLogoBlock,
                    { text: `Offert till ${order.customer_name || ''}`, fontSize: 24, bold: true, color: accentColor, alignment: 'center', margin: [0, 25, 0, 6] },
                    { canvas: [{ type: 'line', x1: 200, y1: 0, x2: 315, y2: 0, lineWidth: 2, lineColor: goldColor }], margin: [0, 0, 0, 30] },
                    ...(heroBlock ? [{ ...heroBlock, margin: [0, 0, 0, 30] }] : []),
                    { columns: [ galleryCol(handleCell, 'Handtag'), galleryCol(modelCell, 'Modell'), galleryCol(countertopCell, 'Bänkskiva'), galleryCol(colorCell, 'Färg') ], columnGap: 15 },
                    { text: '', pageBreak: 'after' }
                ];
            }

            const docDefinition = {
                defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#000000' },
                footer: { text: `${companyName} - Org.nr ${company.org_number || '-'} - Registrerat för moms och F-skatt`, alignment: 'center', fontSize: 8, color: '#666666', margin: [40, 10, 40, 0] },
                content: [
                    ...coverPageContent,
                    { columns: [ headerLeftBlock, { text: [ { text: docTitle + '\n', fontSize: 22, bold: true, color: isOrder ? '#000000' : accentColor }, order.order_number ? { text: `Ordernr: ${order.order_number}`, fontSize: 11, color: '#444444' } : '' ], alignment: 'right', margin: [0, 10, 0, 0] } ] },
                    { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: isOrder ? '#000000' : accentColor }], margin: [0, 15, 0, isOrder ? 20 : 10] },
                    ...(!isOrder ? [{ text: `Tack för att du valt ${companyName}! Nedan hittar du vårt förslag på ditt nya kök, framtaget speciellt för dig.`, italics: true, color: '#555555', fontSize: 10, margin: [0, 0, 0, 15] }] : []),
                    { columns: [ { width: '*', text: [ {text: 'KUNDUPPGIFTER\n', bold: true, color: '#000000', fontSize: 11}, `Namn: ${order.customer_name || '-'}\n`, `Pers.nr: ${order.personnummer || '-'}\n`, `Adress: ${order.address || '-'}\n`, order.address2 ? `Adress 2: ${order.address2}\n` : '', order.apartment_number ? `Lgh.nr: ${order.apartment_number}\n` : '', order.brf_org_nr ? `BRF Org.nr: ${order.brf_org_nr}\n` : '', order.property_designation ? `Fastighetsbet: ${order.property_designation}\n` : '', `Telefon: ${order.phone || '-'}\nE-post: ${order.email || '-'}` ]}, { width: '*', text: [ {text: 'DATUM\n', bold: true, color: '#000000', fontSize: 11}, dateStr ]}, { width: '*', text: [ {text: 'SPECIFIKATION\n', bold: true, color: '#000000', fontSize: 11}, `Bänkskiva: ${specs.material || '-'} (${specs.color || '-'}) \nLucka: ${specs.door || '-'}\nYtbehandling: ${ytbehandling}` ]} ], columnGap: 20, margin: [0, 0, 0, 30] },
                    { text: 'PRODUKTER, MATERIAL & VALDA TJÄNSTER', bold: true, color: isOrder ? '#000000' : accentColor, margin: [0, 0, 0, 8] },
                    { table: { headerRows: 1, widths: [isOrder ? 50 : imgSize + 5, '*', 40], body: tableBody }, layout: 'lightHorizontalLines' },
                    { columns: [ { width: '*', text: '' }, { width: 300, margin: [0, 40, 0, 0], table: { widths: ['*', 'auto'], body: totalsRows }, layout: 'noBorders' } ] },
                    ...(!isOrder ? [{ columns: [ { width: '*', text: '' }, { width: 300, margin: [0, 8, 0, 0], table: { widths: ['*', 'auto'], body: [ [ { text: 'Totalt att betala:', fontSize: 13, bold: true, color: '#ffffff', margin: [10, 10, 0, 10] }, { text: finalToPay.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr', fontSize: 13, bold: true, alignment: 'right', color: '#ffffff', margin: [0, 10, 10, 10] } ] ] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => accentColor } } ] }] : [])
                ], styles: { th: { bold: true, fillColor: '#000000', color: '#ffffff', padding: 6 }, thOffer: { bold: true, fillColor: accentColor, color: '#ffffff', padding: 6 } }
            };

            const termsText = order.public_comment || company.agreement_text || '';
            if (termsText) docDefinition.content.push({ text: 'KOMMENTAR / ÖVRIGA VILLKOR', bold: true, color: '#000000', margin: [0, 30, 0, 8] }, ...htmlToPdfmakeNodes(termsText));
            if (isOrder) docDefinition.content.push({ text: 'SIGNATUR', bold: true, color: '#000000', margin: [0, 40, 0, 20] }, { columns: [ { width: '*', text: 'Ort och Datum\n\n__________________________________', alignment: 'left', color: '#000000' }, { width: '*', text: 'Köparens Underskrift\n\n__________________________________', alignment: 'left', color: '#000000' } ] });
            const pdfDoc = printer.createPdfKitDocument(docDefinition); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${docTitle}_${order.customer_name}.pdf"`); res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); res.setHeader('Pragma', 'no-cache'); pdfDoc.pipe(res); pdfDoc.end();
            } catch (pdfErr) {
                console.error('PDF-generering misslyckades för offert', req.params.id, ':', pdfErr);
                if (!res.headersSent) res.status(500).send('Kunde inte skapa PDF: ' + pdfErr.message);
            }
        });
        });
        });
    });
});

app.get('/api/orders/:id/assembly/pdf', requireAuth, (req, res) => {
    if (!PdfPrinter) return res.status(500).send("PDF-motorn saknas!");
    const fonts = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } }; const printer = new PdfPrinter(fonts);
    db.query('SELECT q.*, c.name as customer_name, c.address, c.phone, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.id = ?', [req.params.id], (err, quoteResults) => {
        if (err || quoteResults.length === 0) return res.status(404).send('Order hittades ej');
        db.query('SELECT sku, name, assembly_comment FROM quote_items WHERE quote_id = ? AND is_free_text = 0', [req.params.id], (err, items) => {
          db.query('SELECT company_name FROM company_settings WHERE id = 1', (err0, companyRes) => {
            const companyName = companyRes && companyRes[0] && companyRes[0].company_name;
            if (!companyName) return res.status(400).send('Företagsinformation saknas. Fyll i företagsnamn under Företagsinfo innan du skapar PDF-dokument.');
            const order = quoteResults[0]; const startDate = order.assembly_start_date ? new Date(order.assembly_start_date).toLocaleDateString('sv-SE') : 'Ej satt';
            const tableBody = [ [{ text: 'Artikel / Beskrivning', style: 'th' }, { text: 'Fabr', style: 'th', alignment: 'center' }, { text: 'I Bil', style: 'th', alignment: 'center' }, { text: 'Mont', style: 'th', alignment: 'center' }] ];
            items.forEach(i => {
                let cellText = [ { text: i.name, bold: true, color: '#000000' }, { text: `\nArt.nr: ${i.sku}`, fontSize: 8, color: '#444444' } ];
                if (i.assembly_comment) cellText.push({ text: `\nSystemkommentar: ${i.assembly_comment}`, fontSize: 8, color: '#000000', italics: true });
                cellText.push({ text: '\nAnteckning: ........................................................................', fontSize: 9, color: '#444444', margin: [0, 5, 0, 0] });
                tableBody.push([ { text: cellText, margin: [0, 5, 0, 5] }, { text: 'O', alignment: 'center', margin: [0, 15, 0, 0], fontSize: 18, color: '#cbd5e0' }, { text: 'O', alignment: 'center', margin: [0, 15, 0, 0], fontSize: 18, color: '#cbd5e0' }, { text: 'O', alignment: 'center', margin: [0, 15, 0, 0], fontSize: 18, color: '#cbd5e0' } ]);
            });
            const docDefinition = {
                defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#000000' },
                content: [
                    { columns: [ { text: companyName, fontSize: 24, bold: true, color: '#000000' }, { text: 'MONTERINGSSPECIFIKATION', fontSize: 14, bold: true, color: '#000000', alignment: 'right', margin: [0, 8, 0, 0] } ] },
                    { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: '#000000' }], margin: [0, 10, 0, 20] },
                    { columns: [ { width: '*', text: [ {text: 'PROJEKTINFO\n', bold: true, color: '#000000'}, `Ordernamn: ${order.quote_name}\nMontagestart: ${startDate}` ]}, { width: '*', text: [ {text: 'PLATS & MONTÖR\n', bold: true, color: '#000000'}, `Kund: ${order.customer_name}\nAdress: ${order.address || '-'}\nMontör: ${order.installer_name || 'Ej vald'}` ]} ], columnGap: 20, margin: [0, 0, 0, 30] },
                    { text: 'ARTIKELFÖRTECKNING & CHECKLISTA', bold: true, color: '#000000', margin: [0, 0, 0, 5] },
                    { table: { headerRows: 1, widths: ['*', 35, 35, 35], body: tableBody }, layout: 'lightHorizontalLines' }
                ], styles: { th: { bold: true, fillColor: '#000000', color: 'white', padding: 5 } }
            };
            if (order.public_comment) docDefinition.content.push( { text: 'KOMMENTAR / ÖVRIGA VILLKOR', bold: true, color: '#000000', margin: [0, 30, 0, 8] }, ...htmlToPdfmakeNodes(order.public_comment) );
            const pdfDoc = printer.createPdfKitDocument(docDefinition); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="Monteringsspec_${order.id}.pdf"`); res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); res.setHeader('Pragma', 'no-cache'); pdfDoc.pipe(res); pdfDoc.end();
          });
        });
    });
});

// ==========================================
// LEVERANTÖRER & PRISPÅSLAG
// ==========================================
app.get('/api/suppliers', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM suppliers ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/suppliers', requireAuth, requireAdmin, (req, res) => {
    const { name, markup_percent, contact_info } = req.body;
    db.query('INSERT INTO suppliers (name, markup_percent, contact_info) VALUES (?, ?, ?)', [name, markup_percent || 0, contact_info || ''], dbResult(res, 'Leverantör sparad!', result => ({ id: result.insertId })));
});
app.put('/api/suppliers/:id', requireAuth, requireAdmin, (req, res) => {
    const { name, markup_percent, contact_info } = req.body;
    db.query('UPDATE suppliers SET name=?, markup_percent=?, contact_info=? WHERE id=?', [name, markup_percent || 0, contact_info || '', req.params.id], dbResult(res, 'Uppdaterad!'));
});
app.delete('/api/suppliers/:id', requireAuth, requireAdmin, (req, res) => db.query('DELETE FROM suppliers WHERE id = ?', [req.params.id], dbResult(res, 'Raderad!')));

// Räkna om försäljningspris (standard_price) för alla produkter kopplade till en leverantör,
// utifrån inköpspris (purchase_price) * (1 + prispåslag%) * (1 + moms%). Rör bara produkter utan varianter.
// Samma formel som dörrmodeller/variantpriser använder, för konsekvens.
app.post('/api/suppliers/:id/recalculate', requireAuth, requireAdmin, (req, res) => {
    db.query('SELECT markup_percent FROM suppliers WHERE id = ?', [req.params.id], (err, supRes) => {
        if (err || !supRes || supRes.length === 0) return res.status(404).json({ message: 'Leverantör hittades inte' });
        const markup = parseFloat(supRes[0].markup_percent) || 0;
        getVatFactor(vatFactor => {
            db.query('UPDATE products SET standard_price = ROUND(purchase_price * ? * ?, 2) WHERE supplier_id = ? AND has_variations = 0 AND purchase_price > 0', [1 + (markup / 100), vatFactor, req.params.id], (err, result) => {
                if (err) return res.status(500).json({ message: err.message });
                res.json({ message: `Priser omräknade för ${result.affectedRows} produkter.` });
            });
        });
    });
});

// ==========================================
// FÖRETAGSINSTÄLLNINGAR (för vidareförsäljning av systemet)
// ==========================================
// OBS: den här endpointen är medvetet publik (ingen requireAuth) - används av index.html
// (inloggningssidans logga) INNAN inloggning, och av menu.js för sidomenyns logga. Därför
// listas kolumnerna explicit (INTE "SELECT *") så känsliga fält som webhook_token aldrig
// läcker ut till en icke-inloggad besökare.
app.get('/api/settings', (req, res) => {
    db.query('SELECT company_name, org_number, logo_url, address, phone, email, agreement_text, vat_rate, pdf_color_primary, pdf_color_accent FROM company_settings WHERE id = 1', (err, results) => {
        res.json(results && results.length > 0 ? results[0] : {});
    });
});
app.put('/api/settings', requireAuth, requireAdmin, upload.single('logo'), (req, res) => {
    const { company_name, org_number, address, phone, email, agreement_text, vat_rate, pdf_color_primary, pdf_color_accent } = req.body;
    let sql = 'UPDATE company_settings SET company_name=?, org_number=?, address=?, phone=?, email=?, agreement_text=?, vat_rate=?, pdf_color_primary=?, pdf_color_accent=?';
    let params = [company_name || '', org_number || '', address || '', phone || '', email || '', agreement_text || '', (vat_rate !== undefined && vat_rate !== '') ? parseFloat(vat_rate) : 25.00, pdf_color_primary || '#2E5339', pdf_color_accent || '#E8A33D'];
    if (req.file) { sql += ', logo_url=?'; params.push('/uploads/' + req.file.filename); }
    sql += ' WHERE id=1';
    db.query(sql, params, dbResult(res, 'Företagsinformation sparad!'));
});

// Skyddad separat endpoint för webhook-token (settings.html/Admin-only) - GET /api/settings
// ovan exkluderar den medvetet eftersom den endpointen är publik.
app.get('/api/settings/webhook-token', requireAuth, requireAdmin, (req, res) => {
    db.query('SELECT webhook_token FROM company_settings WHERE id = 1', (err, results) => {
        res.json({ webhook_token: (results && results[0]) ? results[0].webhook_token : null });
    });
});

app.post('/api/settings/webhook-token/regenerate', requireAuth, requireAdmin, (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.query('UPDATE company_settings SET webhook_token = ? WHERE id = 1', [token], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: 'Ny webhook-URL genererad!', webhook_token: token });
    });
});

// Facebook/Meta Lead Ads-uppgifter - separat skyddad endpoint av samma anledning som
// webhook-token ovan: hålls borta från den publika /api/settings.
app.get('/api/settings/facebook', requireAuth, requireAdmin, (req, res) => {
    db.query('SELECT fb_verify_token, fb_page_access_token, fb_app_secret FROM company_settings WHERE id = 1', (err, results) => {
        res.json(results && results[0] ? results[0] : {});
    });
});
app.put('/api/settings/facebook', requireAuth, requireAdmin, (req, res) => {
    const { fb_page_access_token, fb_app_secret } = req.body;
    db.query('UPDATE company_settings SET fb_page_access_token=?, fb_app_secret=? WHERE id=1',
        [fb_page_access_token || null, fb_app_secret || null], dbResult(res, 'Facebook-inställningar sparade!'));
});
app.post('/api/settings/facebook/generate-token', requireAuth, requireAdmin, (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    db.query('UPDATE company_settings SET fb_verify_token = ? WHERE id = 1', [token], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: 'Ny verifieringstoken genererad!', fb_verify_token: token });
    });
});

// ==========================================
// DÖRRMODELLER & PRISGRUPPER (luckor, lådfronter, grytfronter)
// ==========================================
// Momsfaktorn hämtas från company_settings.vat_rate (konfigurerbar under Företagsinfo) istället för att hårdkodas.
function getVatFactor(callback) {
    db.query('SELECT vat_rate FROM company_settings WHERE id = 1', (err, rows) => {
        const vatRate = (rows && rows[0] && rows[0].vat_rate != null) ? parseFloat(rows[0].vat_rate) : 25;
        callback(1 + vatRate / 100);
    });
}

app.get('/api/door-models', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM door_models WHERE active = 1 ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/door-models', requireAuth, requireAdmin, (req, res) => {
    db.query('INSERT INTO door_models (name) VALUES (?)', [req.body.name], dbResult(res, 'Modell skapad!', result => ({ id: result.insertId })));
});
app.put('/api/door-models/:id', requireAuth, requireAdmin, (req, res) => {
    const { name, price_group_id, accessory_group_id } = req.body;
    db.query('UPDATE door_models SET name=?, price_group_id=?, accessory_group_id=? WHERE id=?',
        [name, price_group_id || null, accessory_group_id || null, req.params.id], dbResult(res, 'Modell uppdaterad!'));
});
app.delete('/api/door-models/:id', requireAuth, requireAdmin, (req, res) => db.query('DELETE FROM door_models WHERE id = ?', [req.params.id], dbResult(res, 'Raderad!')));

// Dörrmodell-prisgrupper: flera modeller (dekornamn) kan dela exakt samma prislista
// genom att peka på samma price_group_id istället för att ha egna door_price_items.
// Samma tabell (door_price_groups) återanvänds som "tillbehörsgrupp" - se products.door_price_group_id.
app.get('/api/door-price-groups', requireAuth, requireStaff, (req, res) => db.query('SELECT * FROM door_price_groups ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/door-price-groups', requireAuth, requireAdmin, (req, res) => {
    db.query('INSERT INTO door_price_groups (name) VALUES (?)', [req.body.name], dbResult(res, 'Grupp skapad!', result => ({ id: result.insertId })));
});
app.put('/api/door-price-groups/:id', requireAuth, requireAdmin, (req, res) => {
    db.query('UPDATE door_price_groups SET name = ? WHERE id = ?', [req.body.name, req.params.id], dbResult(res, 'Grupp uppdaterad!'));
});
app.delete('/api/door-price-groups/:id', requireAuth, requireAdmin, (req, res) => {
    const gid = req.params.id;
    db.query('DELETE FROM door_price_items WHERE price_group_id = ?', [gid], (err) => {
        if (err) return res.status(500).json({ message: err.message });
        db.query('UPDATE door_models SET price_group_id = NULL WHERE price_group_id = ?', [gid], (err2) => {
            if (err2) return res.status(500).json({ message: err2.message });
            db.query('UPDATE door_models SET accessory_group_id = NULL WHERE accessory_group_id = ?', [gid], (err3) => {
                if (err3) return res.status(500).json({ message: err3.message });
                db.query('UPDATE products SET door_price_group_id = NULL WHERE door_price_group_id = ?', [gid], (err4) => {
                    if (err4) return res.status(500).json({ message: err4.message });
                    db.query('DELETE FROM door_price_groups WHERE id = ?', [gid], dbResult(res, 'Grupp raderad!'));
                });
            });
        });
    });
});

// Hämtar modellens price_group_id (om satt) och kör callback(scopeColumn, scopeId) -
// 'price_group_id' + gruppens id om modellen delar prislista, annars 'model_id' + modellens eget id.
function resolveDoorModelScope(modelId, callback) {
    db.query('SELECT price_group_id FROM door_models WHERE id = ?', [modelId], (err, rows) => {
        const groupId = (!err && rows && rows[0] && rows[0].price_group_id) ? rows[0].price_group_id : null;
        if (groupId) callback('price_group_id', groupId);
        else callback('model_id', modelId);
    });
}

app.get('/api/door-models/:id/prices', requireAuth, requireStaff, (req, res) => {
    resolveDoorModelScope(req.params.id, (col, id) => {
        db.query(`SELECT * FROM door_price_items WHERE ${col} = ? ORDER BY component_type, height_min, width_min`, [id], (err, results) => res.json(results || []));
    });
});

app.post('/api/door-models/:id/prices', requireAuth, requireAdmin, (req, res) => {
    const { component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price, installation_price, installer_share } = req.body;
    const purchase = parseFloat(purchase_price) || 0;
    const factor = (markup_factor === '' || markup_factor === undefined || markup_factor === null) ? null : parseFloat(markup_factor);
    getVatFactor(vatFactor => {
        // Om faktor angetts och inget pris skickats med, räkna fram försäljningspriset serverside som facit.
        const finalPrice = (price !== undefined && price !== '' && price !== null) ? parseFloat(price) : (factor !== null ? Math.round(purchase * factor * vatFactor * 100) / 100 : 0);
        resolveDoorModelScope(req.params.id, (col, id) => {
            const modelId = col === 'model_id' ? id : null;
            const groupId = col === 'price_group_id' ? id : null;
            db.query('INSERT INTO door_price_items (model_id, price_group_id, component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price, installation_price, installer_share) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                [modelId, groupId, component_type, height_min || 0, height_max || 100000, width_min || 0, width_max || 100000, purchase, factor, finalPrice, parseFloat(installation_price) || 0, parseFloat(installer_share) || 0],
                dbResult(res, 'Rad tillagd!', result => ({ id: result.insertId })));
        });
    });
});

app.put('/api/door-models/:modelId/prices/:id', requireAuth, requireAdmin, (req, res) => {
    const { component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price, installation_price, installer_share } = req.body;
    const purchase = parseFloat(purchase_price) || 0;
    const factor = (markup_factor === '' || markup_factor === undefined || markup_factor === null) ? null : parseFloat(markup_factor);
    getVatFactor(vatFactor => {
        const finalPrice = (price !== undefined && price !== '' && price !== null) ? parseFloat(price) : (factor !== null ? Math.round(purchase * factor * vatFactor * 100) / 100 : 0);
        // Redigering ändrar bara siffrorna - vilken modell/prisgrupp raden hör till rörs inte.
        db.query('UPDATE door_price_items SET component_type=?, height_min=?, height_max=?, width_min=?, width_max=?, purchase_price=?, markup_factor=?, price=?, installation_price=?, installer_share=? WHERE id=?',
            [component_type, height_min || 0, height_max || 100000, width_min || 0, width_max || 100000, purchase, factor, finalPrice, parseFloat(installation_price) || 0, parseFloat(installer_share) || 0, req.params.id],
            dbResult(res, 'Rad uppdaterad!'));
    });
});

app.post('/api/door-models/:id/prices/bulk', requireAuth, requireAdmin, (req, res) => {
    const rows = req.body;
    if (!rows || rows.length === 0) return res.status(400).json({ message: 'Inga rader skickades in.' });
    getVatFactor(vatFactor => {
        resolveDoorModelScope(req.params.id, (col, id) => {
            const modelId = col === 'model_id' ? id : null;
            const groupId = col === 'price_group_id' ? id : null;
            const values = rows.map(r => {
                const purchase = parseFloat(r.purchase_price) || 0;
                const factor = (r.markup_factor === '' || r.markup_factor === undefined || r.markup_factor === null) ? null : parseFloat(r.markup_factor);
                const finalPrice = (r.price !== undefined && r.price !== '' && r.price !== null) ? parseFloat(r.price) : (factor !== null ? Math.round(purchase * factor * vatFactor * 100) / 100 : 0);
                return [modelId, groupId, r.component_type, r.height_min || 0, r.height_max || 100000, r.width_min || 0, r.width_max || 100000, purchase, factor, finalPrice, parseFloat(r.installation_price) || 0, parseFloat(r.installer_share) || 0];
            });
            db.query('INSERT INTO door_price_items (model_id, price_group_id, component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price, installation_price, installer_share) VALUES ?', [values], (err, result) => {
                if (err) return res.status(500).json({ message: err.message });
                res.json({ message: `${result.affectedRows} rader importerade!` });
            });
        });
    });
});

// Räknar om försäljningspriset för alla rader i modellen (eller dess prisgrupp) som har
// både inköpspris och faktor angivna: pris = inköpspris x faktor x momsfaktor.
// Rader utan faktor (manuellt satta priser) rörs inte.
app.post('/api/door-models/:id/recalculate', requireAuth, requireAdmin, (req, res) => {
    getVatFactor(vatFactor => {
        resolveDoorModelScope(req.params.id, (col, id) => {
            db.query(`UPDATE door_price_items SET price = ROUND(purchase_price * markup_factor * ?, 2) WHERE ${col} = ? AND markup_factor IS NOT NULL AND purchase_price > 0`, [vatFactor, id], (err, result) => {
                if (err) return res.status(500).json({ message: err.message });
                res.json({ message: `Priser omräknade för ${result.affectedRows} rader.` });
            });
        });
    });
});

app.delete('/api/door-models/:modelId/prices/:id', requireAuth, requireAdmin, (req, res) => db.query('DELETE FROM door_price_items WHERE id = ?', [req.params.id], dbResult(res, 'Raderad!')));
app.delete('/api/door-models/:id/prices', requireAuth, requireAdmin, (req, res) => {
    resolveDoorModelScope(req.params.id, (col, id) => {
        db.query(`DELETE FROM door_price_items WHERE ${col} = ?`, [id], dbResult(res, 'Alla rader raderade!'));
    });
});

app.use('/api/*', (req, res) => res.status(404).json({ message: 'API-rutten hittades inte' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server igång på port ${PORT}`));