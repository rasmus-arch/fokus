require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const https = require('https');

let PdfPrinter = null;
try {
    PdfPrinter = require('pdfmake');
    console.log("PDF-motorn laddad framgångsrikt!");
} catch (err) {
    console.warn("Varning: 'pdfmake' saknas! Kör 'npm install pdfmake' i cPanel.");
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true }); 

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

function downloadExternalImage(urlStr, destFolder) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(urlStr);
            const client = urlObj.protocol === 'https:' ? https : http;
            let ext = path.extname(urlObj.pathname).toLowerCase();
            if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) ext = '.jpg';
            const filename = 'dl_' + Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
            const filepath = path.join(destFolder, filename);

            client.get(urlStr, (response) => {
                if (response.statusCode === 200 || response.statusCode === 301 || response.statusCode === 302) {
                    const file = fs.createWriteStream(filepath);
                    file.on('error', () => resolve(null));
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve('/uploads/' + filename); });
                } else resolve(null);
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

function getExternalImageBase64(urlStr) {
    return new Promise((resolve) => {
        try {
            const client = urlStr.startsWith('https') ? https : http;
            client.get(urlStr, (response) => {
                if (response.statusCode === 200) {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
                } else resolve(null);
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

// ANVÄNDARE & LEADS & KUNDER
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, results) => {
        if (err) return res.status(500).json({ message: 'Serverfel' });
        if (results.length > 0) res.json({ message: 'Inloggning lyckades', role: results[0].role, id: results[0].id });
        else res.status(401).json({ message: 'Fel e-post eller lösenord.' });
    });
});
app.get('/api/users', (req, res) => db.query('SELECT id, name, email, role FROM users', (err, results) => res.json(results || [])));
app.get('/api/installers', (req, res) => db.query('SELECT id, name FROM users WHERE role = "Montör"', (err, results) => res.json(results || [])));
app.post('/api/users', (req, res) => {
    const { name, email, password, role } = req.body;
    db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, password, role], (err) => res.json(err ? {message: err.message} : { message: 'Användare skapad!' }));
});
app.delete('/api/users/:id', (req, res) => db.query('DELETE FROM users WHERE id = ?', [req.params.id], () => res.json({ message: 'Borttagen' })));

app.post('/api/webhook/elementor', (req, res) => {
    res.status(200).send("Webhook mottagen!");
    try {
        let name = 'Okänd Lead', email = '', phone = '', kommun = '';
        
        // Supersmart sökfunktion som hittar fälten oavsett vad Elementor döpt dem till
        const findVal = (obj, keywords) => {
            for (let key in obj) {
                let k = key.toLowerCase();
                if (keywords.some(kw => k.includes(kw))) {
                    return obj[key].value !== undefined ? obj[key].value : obj[key];
                }
            }
            return '';
        };

        if (req.body.fields) {
            name = findVal(req.body.fields, ['name', 'namn', 'first_name']);
            email = findVal(req.body.fields, ['email', 'epost', 'e-post']);
            phone = findVal(req.body.fields, ['phone', 'tel', 'mobil']);
            kommun = findVal(req.body.fields, ['kommun', 'city', 'ort']);
        } else {
            name = findVal(req.body, ['name', 'namn']) || name;
            email = findVal(req.body, ['email', 'epost', 'e-post']) || email;
            phone = findVal(req.body, ['phone', 'tel', 'mobil']) || phone;
            kommun = findVal(req.body, ['kommun', 'city', 'ort']) || kommun;
        }

        db.query('INSERT INTO leads (name, email, phone, kommun) VALUES (?, ?, ?, ?)', [name, email, phone, kommun], () => {});
    } catch (error) {}
});

app.get('/api/leads', (req, res) => db.query("SELECT * FROM leads WHERE status = 'Ny' ORDER BY created_at DESC", (err, results) => res.json(results || [])));
app.post('/api/leads/:id/convert', (req, res) => {
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
app.delete('/api/leads/:id', (req, res) => db.query('DELETE FROM leads WHERE id = ?', [req.params.id], () => res.json({ message: 'Lead raderad' })));

app.get('/api/customers', (req, res) => db.query('SELECT * FROM customers ORDER BY created_at DESC', (err, results) => res.json(results || [])));
app.post('/api/customers', (req, res) => {
    const { name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer } = req.body;
    db.query(`INSERT INTO customers (name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer], (err, result) => res.json({ message: 'Kund sparad!', id: result.insertId }));
});
app.put('/api/customers/:id', (req, res) => {
    const { name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer } = req.body;
    db.query(`UPDATE customers SET name=?, address=?, address2=?, apartment_number=?, brf_org_nr=?, property_designation=?, email=?, phone=?, personnummer=? WHERE id=?`, [name, address, address2, apartment_number, brf_org_nr, property_designation, email, phone, personnummer, req.params.id], () => res.json({ message: 'Kund uppdaterad!' }));
});
app.get('/api/customers/:id/quotes', (req, res) => db.query('SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id], (err, results) => res.json(results || [])));

// ==========================================
// PRODUKTER (NU MED VARIANT-STÖD!)
// ==========================================
app.get('/api/products', (req, res) => db.query('SELECT * FROM products ORDER BY id DESC', (err, results) => res.json(results || [])));

const uploadMiddleware = upload.fields([{ name: 'mainImage', maxCount: 1 }, { name: 'galleryImages', maxCount: 10 }]);

app.post('/api/products', (req, res) => {
    uploadMiddleware(req, res, async function (err) {
        if (err) return res.status(400).json({ message: 'Uppladdningsfel' });
        const { id, name, description, sku, cc_measurement, height, length, width, brand, category, installation_price, installer_share, standard_price, purchase_price, supplier_id, front_layout, door_model_id, remove_main_image, retained_gallery, has_variations, variations } = req.body;
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

            let sql = `UPDATE products SET name=?, description=?, sku=?, cc_measurement=?, height=?, length=?, width=?, brand=?, category=?, installation_price=?, installer_share=?, standard_price=?, purchase_price=?, supplier_id=?, front_layout=?, door_model_id=?, gallery=?, has_variations=?, variations=?`;
            let params = [name, description, skuValue, cc_measurement, height||0, length||0, width||0, brand, category, installation_price||0, installer_share||0, standard_price||0, purchase_price||0, supplier_id || null, front_layout || null, door_model_id || null, JSON.stringify(finalGallery), has_variations === 'true' ? 1 : 0, finalVariations];

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
            const sql = `INSERT INTO products (name, description, sku, cc_measurement, height, length, width, brand, category, image_url, gallery, installation_price, installer_share, standard_price, purchase_price, supplier_id, front_layout, door_model_id, has_variations, variations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.query(sql, [name, description, skuValue, cc_measurement, height||0, length||0, width||0, brand, category, finalMain, JSON.stringify(finalGallery), installation_price||0, installer_share||0, standard_price||0, purchase_price||0, supplier_id || null, front_layout || null, door_model_id || null, has_variations === 'true' ? 1 : 0, finalVariations], (err) => {
                if (err) return res.status(500).json({ message: 'Kunde inte spara produkten: ' + err.message });
                res.json({ message: 'Sparad!' });
            });
        }
    });
});

app.post('/api/products/bulk', async (req, res) => {
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

app.delete('/api/products/:id', (req, res) => db.query('DELETE FROM products WHERE id = ?', [req.params.id], () => res.json({ message: 'Raderad!' })));

// ==========================================
// RESTEN AV API:ER (BÄNKSKIVOR & OFFERTER - OFÖRÄNDRADE)
// ==========================================
app.get('/api/countertops/config', (req, res) => {
    db.query('SELECT * FROM countertop_materials', (err1, materials) => {
        db.query('SELECT * FROM countertop_colors', (err2, colors) => {
            db.query('SELECT * FROM countertop_prices', (err3, prices) => {
                db.query('SELECT * FROM countertop_services', (err4, services) => {
                    db.query('SELECT * FROM countertop_edges', (err5, edges) => {
                        res.json({ materials: materials||[], colors: colors||[], prices: prices||[], services: services||[], edges: edges||[] });
                    });
                });
            });
        });
    });
});
const ctTables = ['materials', 'colors', 'prices', 'services', 'edges'];
ctTables.forEach(table => {
    app.post(`/api/countertops/${table}`, (req, res) => {
        if (table === 'prices' && req.body.color_ids) {
            const { depth_min, depth_max, price_per_lm, thickness, color_ids } = req.body;
            if (!color_ids || color_ids.length === 0) return res.status(400).json({error: "Inga färger angivna"});
            const values = color_ids.map(id => [id, depth_min, depth_max, price_per_lm, thickness]);
            db.query(`INSERT INTO countertop_prices (color_id, depth_min, depth_max, price_per_lm, thickness) VALUES ?`, [values], (err) => res.json(err ? {error: err.message} : {message: 'Priserna har sparats på alla valda färger!'}));
        } else db.query(`INSERT INTO countertop_${table} SET ?`, req.body, (err) => res.json(err ? {error: err.message} : {message: 'Sparad'}));
    });
    app.put(`/api/countertops/${table}/:id`, (req, res) => db.query(`UPDATE countertop_${table} SET ? WHERE id = ?`, [req.body, req.params.id], (err) => res.json(err ? {error: err.message} : {message: 'Uppdaterad'})));
    app.delete(`/api/countertops/${table}/:id`, (req, res) => db.query(`DELETE FROM countertop_${table} WHERE id = ?`, [req.params.id], (err) => res.json(err ? {error: err.message} : {message: 'Raderad'})));
});

app.get('/api/quotes', (req, res) => db.query(`SELECT q.*, c.name as customer_name, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.status != 'Order' ORDER BY q.created_at DESC`, (err, results) => res.json(results || [])));
app.get('/api/orders', (req, res) => {
    const installerId = req.query.installer_id;
    db.query(`SELECT q.*, c.name as customer_name, c.address, c.phone, c.email, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.status = 'Order' ORDER BY q.created_at DESC`, installerId ? [installerId] : [], (err, results) => res.json(results || []));
});
app.get('/api/quotes/:id', (req, res) => db.query('SELECT q.*, c.name as customer_name, c.address, c.address2, c.apartment_number, c.brf_org_nr, c.property_designation, c.email, c.phone, c.personnummer FROM quotes q JOIN customers c ON q.customer_id = c.id WHERE q.id = ?', [req.params.id], (err, results) => res.json(results && results.length > 0 ? results[0] : null)));
app.post('/api/quotes', (req, res) => db.query('INSERT INTO quotes (customer_id, quote_name, status) VALUES (?, ?, "Utkast")', [req.body.customer_id, req.body.quote_name], (err, result) => res.json({ message: 'Offert skapad!', quoteId: result.insertId })));
app.put('/api/quotes/:id/status', (req, res) => {
    const { status, installer_id, user_name } = req.body; const quoteId = req.params.id;
    if (status === 'Order') {
        db.query('SELECT order_number FROM quotes WHERE id = ?', [quoteId], (err, results) => {
            if (results && results[0] && results[0].order_number) db.query('UPDATE quotes SET status = ?, installer_id = ? WHERE id = ?', [status, installer_id || null, quoteId], () => res.json({message: 'Uppdaterad!'}));
            else {
                let minRange = 1000, maxRange = 1999; if (user_name === 'Rasmus') { minRange = 2000; maxRange = 2999; } else if (user_name === 'Peter') { minRange = 3000; maxRange = 3999; }
                db.query('SELECT MAX(order_number) as max_num FROM quotes WHERE order_number >= ? AND order_number <= ?', [minRange, maxRange], (err, maxRes) => {
                    let newOrderNumber = maxRes && maxRes[0].max_num ? maxRes[0].max_num + 1 : minRange;
                    db.query('UPDATE quotes SET status = ?, installer_id = ?, order_number = ? WHERE id = ?', [status, installer_id || null, newOrderNumber, quoteId], () => res.json({message: `Order skapad med ordernummer #${newOrderNumber}!`}));
                });
            }
        });
    } else db.query('UPDATE quotes SET status = ?, installer_id = ? WHERE id = ?', [status, installer_id || null, quoteId], () => res.json({message: 'Uppdaterad!'}));
});
app.put('/api/quotes/:id', (req, res) => {
    const { quoteCart, selectedConditions, kitchenSpecs, extraFees, globalDiscount, discountType, useRot, internal_comment, public_comment } = req.body;
    db.query('UPDATE quotes SET global_discount = ?, discount_type = ?, quote_data = ?, internal_comment = ?, public_comment = ? WHERE id = ?', 
        [globalDiscount || 0, discountType || '%', JSON.stringify({ selectedConditions, kitchenSpecs, extraFees, quoteCart, useRot }), internal_comment || null, public_comment || null, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Fel vid sparning." });
        db.query('DELETE FROM quote_items WHERE quote_id = ?', [req.params.id], () => {
            if (!quoteCart || quoteCart.length === 0) return res.json({ message: 'Offerten har sparats.' });
            const values = quoteCart.map(i => [req.params.id, i.id || null, i.sku, i.name, i.priceIncVat, i.installIncVat, i.qty, i.isFreeText ? 1 : 0]);
            db.query('INSERT INTO quote_items (quote_id, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text) VALUES ?', [values], () => res.json({ message: 'Offerten har sparats framgångsrikt!' }));
        });
    });
});
app.post('/api/quotes/:id/duplicate', (req, res) => {
    db.query('SELECT * FROM quotes WHERE id = ?', [req.params.id], (err, quoteResults) => {
        const o = quoteResults[0];
        db.query('INSERT INTO quotes (customer_id, quote_name, status, quote_data, global_discount, discount_type, internal_comment, public_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [o.customer_id, o.quote_name + ' (Kopia)', 'Utkast', o.quote_data, o.global_discount, o.discount_type, o.internal_comment, o.public_comment], (err, newQuoteResult) => {
            db.query('INSERT INTO quote_items (quote_id, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text) SELECT ?, product_id, sku, name, price_inc_vat, install_inc_vat, qty, is_free_text FROM quote_items WHERE quote_id = ?', [newQuoteResult.insertId, req.params.id], () => res.json({ message: 'Duplicerad!' }));
        });
    });
});
app.put('/api/orders/:id/comments', (req, res) => db.query('UPDATE quotes SET internal_comment = ?, public_comment = ? WHERE id = ?', [req.body.internal_comment || null, req.body.public_comment || null, req.params.id], () => res.json({ message: 'Kommentarer sparade!' })));
app.get('/api/orders/:id/files', (req, res) => db.query('SELECT * FROM order_files WHERE quote_id = ? ORDER BY created_at DESC', [req.params.id], (err, results) => res.json(results || [])));
app.post('/api/orders/:id/files', upload.single('file'), (req, res) => {
    const fileType = ['.jpg', '.jpeg', '.png', '.heic', '.gif'].includes(path.extname(req.file.originalname).toLowerCase()) ? 'image' : 'document';
    db.query('INSERT INTO order_files (quote_id, file_name, file_url, file_type, uploaded_by) VALUES (?,?,?,?,?)', [req.params.id, req.file.originalname, '/uploads/' + req.file.filename, fileType, req.body.user_id || null], () => res.json({ message: 'Fil uppladdad!' }));
});
app.delete('/api/orders/files/:fileId', (req, res) => {
    db.query('SELECT file_url FROM order_files WHERE id = ?', [req.params.fileId], (err, results) => {
        if(results && results.length > 0) db.query('DELETE FROM order_files WHERE id = ?', [req.params.fileId], () => { fs.unlink(path.join(__dirname, 'public', results[0].file_url), () => res.json({ message: 'Raderad' })); });
        else res.json({message: 'Redan raderad'});
    });
});
app.get('/api/orders/:id/assembly', (req, res) => {
    db.query('SELECT q.*, c.name as customer_name, c.address, c.phone, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.id = ?', [req.params.id], (err, quoteRes) => {
        db.query('SELECT id, sku, name, is_delivered, is_packed, is_assembled, assembly_comment FROM quote_items WHERE quote_id = ? AND is_free_text = 0', [req.params.id], (err, itemsRes) => res.json({ quote: quoteRes[0], items: itemsRes || [] }));
    });
});
app.put('/api/orders/:id/assembly/status', (req, res) => db.query(`UPDATE quotes SET factory_date = ?, assembly_start_date = ?, assembly_completed_date = ?, assembly_status = ? WHERE id = ?`, [req.body.factory_date || null, req.body.assembly_start_date || null, req.body.assembly_completed_date || null, req.body.assembly_status || 'Ej påbörjad', req.params.id], () => res.json({ message: 'Sparat!' })));
app.put('/api/orders/assembly/item/:itemId', (req, res) => db.query(`UPDATE quote_items SET is_delivered = ?, is_packed = ?, is_assembled = ?, assembly_comment = ? WHERE id = ?`, [req.body.is_delivered ? 1 : 0, req.body.is_packed ? 1 : 0, req.body.is_assembled ? 1 : 0, req.body.assembly_comment, req.params.itemId], () => res.json({ message: 'Sparat!' })));
app.get('/api/statistics', (req, res) => db.query('SELECT category, COUNT(*) as count FROM products GROUP BY category', (err, results) => res.json({ categories: results && results.length > 0 ? results : [{ category: 'Inga', count: 0 }] })));

// PDF GENERATORS BEHÅLLS INTAKTA (Förkortade kommentarer)
app.get('/api/quotes/:id/pdf', (req, res) => {
    if (!PdfPrinter) return res.status(500).send("PDF-motorn saknas!");
    const fonts = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } };
    const printer = new PdfPrinter(fonts);
    db.query('SELECT q.*, c.name as customer_name, c.address, c.address2, c.apartment_number, c.brf_org_nr, c.property_designation, c.email, c.phone, c.personnummer FROM quotes q JOIN customers c ON q.customer_id = c.id WHERE q.id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Hittades inte');
        const order = results[0];
        let cart = []; let specs = {}; let selectedConditions = {}; let extraFees = {}; let useRot = true;
        if (order.quote_data) { try { const parsed = JSON.parse(order.quote_data); if (parsed.quoteCart) cart = parsed.quoteCart; if (parsed.kitchenSpecs) specs = parsed.kitchenSpecs; if (parsed.selectedConditions) selectedConditions = parsed.selectedConditions; if (parsed.extraFees) extraFees = parsed.extraFees; if (parsed.useRot !== undefined) useRot = parsed.useRot; } catch(e) {} }
        const isOrder = order.status === 'Order'; const docTitle = isOrder ? 'KÖPEAVTAL' : 'OFFERT'; const dateStr = new Date(order.created_at).toLocaleDateString('sv-SE');

        db.query('SELECT * FROM company_settings WHERE id = 1', (err0, companyRes) => {
            const company = companyRes && companyRes.length > 0 ? companyRes[0] : {};
            const companyName = company.company_name || 'KLARÄLVSKÖK';
            let headerLeftBlock = { text: companyName, fontSize: 24, bold: true, color: '#000000' };
            const logoPath = company.logo_url ? path.join(__dirname, 'public', company.logo_url.replace(/^\/?(public\/)?/, '')) : path.join(__dirname, 'public', 'uploads', 'Klaralvskok-logga-1.jpg');
            if (fs.existsSync(logoPath)) { const ext = path.extname(logoPath).toLowerCase(); const mime = ext === '.png' ? 'image/png' : 'image/jpeg'; headerLeftBlock = { image: `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`, width: 140 }; }
            let ytbehandling = extraFees.colorSelect || '-'; if (extraFees.colorSelect === 'Valfri NCS-kod' && extraFees.colorCustom) ytbehandling = `NCS: ${extraFees.colorCustom}`;
            const tableBody = [ [{ text: '', style: 'th', alignment: 'center' }, { text: 'Artikel / Beskrivning', style: 'th' }, { text: 'Antal', style: 'th', alignment: 'center' }] ];
        
        db.query('SELECT id, sku, image_url FROM products', async (err, dbProducts) => {
            if (err) dbProducts = []; let totalMaterialBeforeGlobalDiscount = 0;
            for (let item of cart) {
                const rowMaterialTotal = (item.priceIncVat * (1 - (item.discount / 100))) * item.qty; totalMaterialBeforeGlobalDiscount += rowMaterialTotal;
                let pdfImageCell = { text: '', alignment: 'center', margin: [0, 10] }; const dbProd = dbProducts.find(p => p.sku === item.sku || p.id == item.id);
                if (dbProd && dbProd.image_url) {
                    let rawUrl = dbProd.image_url.split('?')[0]; 
                    if (rawUrl.startsWith('http')) {
                        const base64 = await getExternalImageBase64(rawUrl);
                        if (base64) { const mime = rawUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'; pdfImageCell = { image: `data:${mime};base64,${base64}`, width: 45, height: 45, alignment: 'center', margin: [0, 5, 0, 5] }; }
                    } else {
                        let cleanPath = rawUrl.startsWith('/') ? rawUrl.substring(1) : rawUrl; if (cleanPath.startsWith('public/')) cleanPath = cleanPath.substring(7);
                        const fullImgPath = path.join(__dirname, 'public', cleanPath);
                        if (fs.existsSync(fullImgPath)) {
                            const ext = path.extname(fullImgPath).toLowerCase();
                            if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
                                try { const mime = ext === '.png' ? 'image/png' : 'image/jpeg'; pdfImageCell = { image: `data:${mime};base64,${fs.readFileSync(fullImgPath).toString('base64')}`, width: 45, height: 45, alignment: 'center', margin: [0, 5, 0, 5] }; } catch (e) {}
                            }
                        }
                    }
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

            const startFeeProduct = parseFloat(extraFees.startFeeProduct) || 0; const startFeeNonRot = parseFloat(extraFees.startFeeNonRot) || 1800; const startFeeRotComp = parseFloat(extraFees.startFeeRotComp) || 0; const startFeeRotInst = parseFloat(extraFees.startFeeRotInst) || 0; const colorFee = parseFloat(extraFees.feeColor) || 0;
            totalMaterialBeforeGlobalDiscount += startFeeProduct + colorFee; totalNonRotInstallIncVat += startFeeNonRot; totalRotInstallIncVat += (startFeeRotComp + startFeeRotInst);
            const globalDiscountVal = parseFloat(order.global_discount) || 0; const globalDiscountType = order.discount_type || '%';
            let globalDiscountAmount = globalDiscountType === '%' ? totalMaterialBeforeGlobalDiscount * (globalDiscountVal / 100) : globalDiscountVal;
            let totalMaterialIncVat = Math.max(0, totalMaterialBeforeGlobalDiscount - globalDiscountAmount);
            const rotDeduction = useRot ? (totalRotInstallIncVat * 0.30) : 0; const totalAssemblyCost = totalRotInstallIncVat + totalNonRotInstallIncVat; const finalToPay = totalMaterialIncVat + totalAssemblyCost - rotDeduction;

            const docDefinition = {
                defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#000000' },
                content: [
                    { columns: [ headerLeftBlock, { text: docTitle, fontSize: 22, bold: true, color: '#000000', alignment: 'right', margin: [0, 10, 0, 0] } ] },
                    { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: '#000000' }], margin: [0, 15, 0, 20] },
                    { columns: [ { width: '*', text: [ {text: 'KUNDUPPGIFTER\n', bold: true, color: '#000000', fontSize: 11}, `Namn: ${order.customer_name}\n`, order.personnummer ? `Pers.nr: ${order.personnummer}\n` : '', `Adress: ${order.address || '-'}\n`, order.address2 ? `Adress 2: ${order.address2}\n` : '', order.apartment_number ? `Lgh.nr: ${order.apartment_number}\n` : '', order.brf_org_nr ? `BRF Org.nr: ${order.brf_org_nr}\n` : '', order.property_designation ? `Fastighetsbet: ${order.property_designation}\n` : '', `Telefon: ${order.phone || '-'}\nE-post: ${order.email || '-'}` ]}, { width: '*', text: [ {text: 'DOKUMENTINFO\n', bold: true, color: '#000000', fontSize: 11}, `Datum: ${dateStr}\nProjekt: ${order.quote_name}`, company.org_number ? `\n${companyName}, Org.nr: ${company.org_number}` : '' ]}, { width: '*', text: [ {text: 'SPECIFIKATION\n', bold: true, color: '#000000', fontSize: 11}, `Bänkskiva: ${specs.material || '-'} (${specs.color || '-'}) \nLucka: ${specs.door || '-'}\nYtbehandling: ${ytbehandling}` ]} ], columnGap: 20, margin: [0, 0, 0, 30] },
                    { text: 'PRODUKTER, MATERIAL & VALDA TJÄNSTER', bold: true, color: '#000000', margin: [0, 0, 0, 8] },
                    { table: { headerRows: 1, widths: [50, '*', 40], body: tableBody }, layout: 'lightHorizontalLines' },
                    { columns: [ { width: '*', text: '' }, { width: 300, margin: [0, 40, 0, 0], table: { widths: ['*', 'auto'], body: [ [ { text: 'Produktkostnad innan rabatt:', color: '#000000' }, { text: totalMaterialBeforeGlobalDiscount.toLocaleString('sv-SE') + ' kr', alignment: 'right', color: '#000000' } ], [ { text: 'Rabatt:', color: '#000000' }, { text: `- ${globalDiscountAmount.toLocaleString('sv-SE')} kr`, alignment: 'right', color: '#000000' } ], [ { text: 'Summa produktkostnad:', bold: true, color: '#000000' }, { text: totalMaterialIncVat.toLocaleString('sv-SE') + ' kr', alignment: 'right', bold: true, color: '#000000' } ], [ { text: 'Rot-berättigad monteringskostnad:', color: '#000000' }, { text: totalRotInstallIncVat.toLocaleString('sv-SE') + ' kr', alignment: 'right', color: '#000000' } ], [ { text: 'ROT-avdrag (30%):', color: '#000000' }, { text: useRot ? `- ${rotDeduction.toLocaleString('sv-SE')} kr` : '0 kr', alignment: 'right', color: '#000000' } ], [ { text: 'Summa montering efter rotavdrag:', bold: true, color: '#000000' }, { text: (totalAssemblyCost - rotDeduction).toLocaleString('sv-SE') + ' kr', alignment: 'right', bold: true, color: '#000000' } ], [ { text: 'Totalt att betala:', fontSize: 12, bold: true, color: '#000000' }, { text: finalToPay.toLocaleString('sv-SE') + ' kr', fontSize: 12, bold: true, alignment: 'right', color: '#000000' } ] ] }, layout: 'noBorders' } ] }
                ], styles: { th: { bold: true, fillColor: '#000000', color: '#ffffff', padding: 6 } }
            };

            const termsText = order.public_comment || company.agreement_text || '';
            if (termsText) docDefinition.content.push({ text: 'KOMMENTAR / ÖVRIGA VILLKOR', bold: true, color: '#000000', margin: [0, 30, 0, 8] }, { text: termsText, color: '#000000', fontSize: 10, margin: [0, 0, 0, 20] });
            if (isOrder) docDefinition.content.push({ text: 'SIGNATUR', bold: true, color: '#000000', margin: [0, 40, 0, 20] }, { columns: [ { width: '*', text: 'Ort och Datum\n\n__________________________________', alignment: 'left', color: '#000000' }, { width: '*', text: 'Köparens Underskrift\n\n__________________________________', alignment: 'left', color: '#000000' } ] });
            const pdfDoc = printer.createPdfKitDocument(docDefinition); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${docTitle}_${order.customer_name}.pdf"`); pdfDoc.pipe(res); pdfDoc.end();
        });
        });
    });
});

app.get('/api/orders/:id/assembly/pdf', (req, res) => {
    if (!PdfPrinter) return res.status(500).send("PDF-motorn saknas!");
    const fonts = { Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } }; const printer = new PdfPrinter(fonts);
    db.query('SELECT q.*, c.name as customer_name, c.address, c.phone, u.name as installer_name FROM quotes q JOIN customers c ON q.customer_id = c.id LEFT JOIN users u ON q.installer_id = u.id WHERE q.id = ?', [req.params.id], (err, quoteResults) => {
        if (err || quoteResults.length === 0) return res.status(404).send('Order hittades ej');
        db.query('SELECT sku, name, assembly_comment FROM quote_items WHERE quote_id = ? AND is_free_text = 0', [req.params.id], (err, items) => {
          db.query('SELECT company_name FROM company_settings WHERE id = 1', (err0, companyRes) => {
            const companyName = (companyRes && companyRes[0] && companyRes[0].company_name) || 'KLARÄLVSKÖK';
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
            if (order.public_comment) docDefinition.content.push( { text: 'KOMMENTAR / ÖVRIGA VILLKOR', bold: true, color: '#000000', margin: [0, 30, 0, 8] }, { text: order.public_comment, color: '#000000', fontSize: 10, margin: [0, 0, 0, 20] } );
            const pdfDoc = printer.createPdfKitDocument(docDefinition); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="Monteringsspec_${order.id}.pdf"`); pdfDoc.pipe(res); pdfDoc.end();
          });
        });
    });
});

// ==========================================
// LEVERANTÖRER & PRISPÅSLAG
// ==========================================
app.get('/api/suppliers', (req, res) => db.query('SELECT * FROM suppliers ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/suppliers', (req, res) => {
    const { name, markup_percent, contact_info } = req.body;
    db.query('INSERT INTO suppliers (name, markup_percent, contact_info) VALUES (?, ?, ?)', [name, markup_percent || 0, contact_info || ''], (err, result) => res.json(err ? { message: err.message } : { message: 'Leverantör sparad!', id: result.insertId }));
});
app.put('/api/suppliers/:id', (req, res) => {
    const { name, markup_percent, contact_info } = req.body;
    db.query('UPDATE suppliers SET name=?, markup_percent=?, contact_info=? WHERE id=?', [name, markup_percent || 0, contact_info || '', req.params.id], (err) => res.json(err ? { message: err.message } : { message: 'Uppdaterad!' }));
});
app.delete('/api/suppliers/:id', (req, res) => db.query('DELETE FROM suppliers WHERE id = ?', [req.params.id], (err) => res.json(err ? { message: err.message } : { message: 'Raderad!' })));

// Räkna om försäljningspris (standard_price) för alla produkter kopplade till en leverantör,
// utifrån inköpspris (purchase_price) * (1 + prispåslag%). Rör bara produkter utan varianter.
app.post('/api/suppliers/:id/recalculate', (req, res) => {
    db.query('SELECT markup_percent FROM suppliers WHERE id = ?', [req.params.id], (err, supRes) => {
        if (err || !supRes || supRes.length === 0) return res.status(404).json({ message: 'Leverantör hittades inte' });
        const markup = parseFloat(supRes[0].markup_percent) || 0;
        db.query('UPDATE products SET standard_price = ROUND(purchase_price * ?, 2) WHERE supplier_id = ? AND has_variations = 0 AND purchase_price > 0', [1 + (markup / 100), req.params.id], (err, result) => {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: `Priser omräknade för ${result.affectedRows} produkter.` });
        });
    });
});

// ==========================================
// FÖRETAGSINSTÄLLNINGAR (för vidareförsäljning av systemet)
// ==========================================
app.get('/api/settings', (req, res) => {
    db.query('SELECT * FROM company_settings WHERE id = 1', (err, results) => {
        res.json(results && results.length > 0 ? results[0] : {});
    });
});
app.put('/api/settings', upload.single('logo'), (req, res) => {
    const { company_name, org_number, address, phone, email, agreement_text } = req.body;
    let sql = 'UPDATE company_settings SET company_name=?, org_number=?, address=?, phone=?, email=?, agreement_text=?';
    let params = [company_name || '', org_number || '', address || '', phone || '', email || '', agreement_text || ''];
    if (req.file) { sql += ', logo_url=?'; params.push('/uploads/' + req.file.filename); }
    sql += ' WHERE id=1';
    db.query(sql, params, (err) => res.json(err ? { message: err.message } : { message: 'Företagsinformation sparad!' }));
});

// ==========================================
// DÖRRMODELLER & PRISGRUPPER (luckor, lådfronter, grytfronter)
// ==========================================
const DOOR_VAT_FACTOR = 1.25; // 25% moms - används när försäljningspris räknas fram från inköpspris x faktor

app.get('/api/door-models', (req, res) => db.query('SELECT * FROM door_models WHERE active = 1 ORDER BY name ASC', (err, results) => res.json(results || [])));
app.post('/api/door-models', (req, res) => {
    db.query('INSERT INTO door_models (name) VALUES (?)', [req.body.name], (err, result) => res.json(err ? { message: err.message } : { message: 'Modell skapad!', id: result.insertId }));
});
app.delete('/api/door-models/:id', (req, res) => db.query('DELETE FROM door_models WHERE id = ?', [req.params.id], (err) => res.json(err ? { message: err.message } : { message: 'Raderad!' })));

app.get('/api/door-models/:id/prices', (req, res) => db.query('SELECT * FROM door_price_items WHERE model_id = ? ORDER BY component_type, height_min, width_min', [req.params.id], (err, results) => res.json(results || [])));

app.post('/api/door-models/:id/prices', (req, res) => {
    const { component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price } = req.body;
    const purchase = parseFloat(purchase_price) || 0;
    const factor = (markup_factor === '' || markup_factor === undefined || markup_factor === null) ? null : parseFloat(markup_factor);
    // Om faktor angetts och inget pris skickats med, räkna fram försäljningspriset serverside som facit.
    const finalPrice = (price !== undefined && price !== '' && price !== null) ? parseFloat(price) : (factor !== null ? Math.round(purchase * factor * DOOR_VAT_FACTOR * 100) / 100 : 0);
    db.query('INSERT INTO door_price_items (model_id, component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price) VALUES (?,?,?,?,?,?,?,?,?)',
        [req.params.id, component_type, height_min || 0, height_max || 100000, width_min || 0, width_max || 100000, purchase, factor, finalPrice],
        (err, result) => res.json(err ? { message: err.message } : { message: 'Rad tillagd!', id: result.insertId }));
});

app.put('/api/door-models/:modelId/prices/:id', (req, res) => {
    const { component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price } = req.body;
    const purchase = parseFloat(purchase_price) || 0;
    const factor = (markup_factor === '' || markup_factor === undefined || markup_factor === null) ? null : parseFloat(markup_factor);
    const finalPrice = (price !== undefined && price !== '' && price !== null) ? parseFloat(price) : (factor !== null ? Math.round(purchase * factor * DOOR_VAT_FACTOR * 100) / 100 : 0);
    db.query('UPDATE door_price_items SET component_type=?, height_min=?, height_max=?, width_min=?, width_max=?, purchase_price=?, markup_factor=?, price=? WHERE id=? AND model_id=?',
        [component_type, height_min || 0, height_max || 100000, width_min || 0, width_max || 100000, purchase, factor, finalPrice, req.params.id, req.params.modelId],
        (err) => res.json(err ? { message: err.message } : { message: 'Rad uppdaterad!' }));
});

app.post('/api/door-models/:id/prices/bulk', (req, res) => {
    const rows = req.body;
    if (!rows || rows.length === 0) return res.status(400).json({ message: 'Inga rader skickades in.' });
    const values = rows.map(r => {
        const purchase = parseFloat(r.purchase_price) || 0;
        const factor = (r.markup_factor === '' || r.markup_factor === undefined || r.markup_factor === null) ? null : parseFloat(r.markup_factor);
        const finalPrice = (r.price !== undefined && r.price !== '' && r.price !== null) ? parseFloat(r.price) : (factor !== null ? Math.round(purchase * factor * DOOR_VAT_FACTOR * 100) / 100 : 0);
        return [req.params.id, r.component_type, r.height_min || 0, r.height_max || 100000, r.width_min || 0, r.width_max || 100000, purchase, factor, finalPrice];
    });
    db.query('INSERT INTO door_price_items (model_id, component_type, height_min, height_max, width_min, width_max, purchase_price, markup_factor, price) VALUES ?', [values], (err, result) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: `${result.affectedRows} rader importerade!` });
    });
});

// Räknar om försäljningspriset för alla rader i modellen som har både inköpspris och faktor angivna:
// pris = inköpspris x faktor x 1,25 (moms). Rader utan faktor (manuellt satta priser) rörs inte.
app.post('/api/door-models/:id/recalculate', (req, res) => {
    db.query('UPDATE door_price_items SET price = ROUND(purchase_price * markup_factor * ?, 2) WHERE model_id = ? AND markup_factor IS NOT NULL AND purchase_price > 0', [DOOR_VAT_FACTOR, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ message: `Priser omräknade för ${result.affectedRows} rader.` });
    });
});

app.delete('/api/door-models/:modelId/prices/:id', (req, res) => db.query('DELETE FROM door_price_items WHERE id = ? AND model_id = ?', [req.params.id, req.params.modelId], (err) => res.json(err ? { message: err.message } : { message: 'Raderad!' })));
app.delete('/api/door-models/:id/prices', (req, res) => db.query('DELETE FROM door_price_items WHERE model_id = ?', [req.params.id], (err) => res.json(err ? { message: err.message } : { message: 'Alla rader raderade!' })));

app.use('/api/*', (req, res) => res.status(404).json({ message: 'API-rutten hittades inte' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server igång på port ${PORT}`));