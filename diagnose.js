console.log('--- Diagnos startar ---');

console.log('Node-version:', process.version);
console.log('Arbetsmapp (cwd):', process.cwd());

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
console.log('.env finns:', fs.existsSync(envPath));
if (fs.existsSync(envPath)) {
    const dotenv = require('dotenv');
    console.log('.env-nycklar (inte värden):', Object.keys(dotenv.parse(fs.readFileSync(envPath))));
}

console.log('node_modules finns:', fs.existsSync(path.join(__dirname, 'node_modules')));
console.log('server.js finns:', fs.existsSync(path.join(__dirname, 'server.js')));
console.log('public/index.html finns:', fs.existsSync(path.join(__dirname, 'public', 'index.html')));

require('dotenv').config();

try {
    require('express');
    console.log('express: OK, kan laddas');
} catch (e) {
    console.log('express: FEL -', e.message);
}

try {
    const mysql = require('mysql2');
    console.log('mysql2: OK, kan laddas');
    const db = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT
    });
    db.query('SELECT 1 as test', (err, results) => {
        if (err) console.log('Databasanslutning: FEL -', err.message);
        else console.log('Databasanslutning: OK -', JSON.stringify(results));
        console.log('--- Diagnos klar ---');
        process.exit(0);
    });
} catch (e) {
    console.log('mysql2: FEL -', e.message);
    console.log('--- Diagnos klar ---');
    process.exit(1);
}
