const crypto = require('crypto');

// Lösenordshashning med Node:s inbyggda scrypt - ingen ny npm-dependency behövs
// (viktigt på cPanel-hosting där nya paket inte alltid går att installera enkelt).
// Format: "salt:hash", båda hex-kodade, lagras rakt av i users.password (varchar(255)).
function hashPassword(plain) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    try {
        const hashBuffer = Buffer.from(hash, 'hex');
        const suppliedHashBuffer = crypto.scryptSync(plain, salt, 64);
        if (hashBuffer.length !== suppliedHashBuffer.length) return false;
        return crypto.timingSafeEqual(hashBuffer, suppliedHashBuffer);
    } catch (e) {
        return false;
    }
}

// Sessionshantering kräver databasen - injiceras via initSessions(db) istället för att
// den här filen skapar en egen anslutning eller kräver server.js (cirkulärt beroende).
function initSessions(db) {
    function createSession(user, callback) {
        const token = crypto.randomBytes(32).toString('hex');
        db.query('INSERT INTO sessions (token, user_id, name, role) VALUES (?, ?, ?, ?)', [token, user.id, user.name, user.role], (err) => callback(err, token));
    }

    function deleteSession(token, callback) {
        db.query('DELETE FROM sessions WHERE token = ?', [token], callback || (() => {}));
    }

    // Rensar sessioner äldre än 30 dagar - samma lat-rensningsmönster som offert-papperskorgen.
    function purgeExpiredSessions() {
        db.query('DELETE FROM sessions WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)', () => {});
    }

    // Accepterar token antingen via Authorization-header (vanliga fetch-anrop) eller ?token=
    // query-parameter (behövs för vanliga <a href>-länknavigeringar, t.ex. PDF-knappar, som
    // inte kan bära anpassade headers).
    function requireAuth(req, res, next) {
        const authHeader = req.headers['authorization'];
        const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const token = headerToken || req.query.token;
        if (!token) return res.status(401).json({ message: 'Inte inloggad.' });
        db.query('SELECT * FROM sessions WHERE token = ?', [token], (err, rows) => {
            if (err || !rows.length) return res.status(401).json({ message: 'Sessionen har gått ut eller är ogiltig. Logga in igen.' });
            req.user = { id: rows[0].user_id, name: rows[0].name, role: rows[0].role };
            next();
        });
    }

    function requireRole(...roles) {
        return (req, res, next) => {
            if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'Du saknar behörighet för att göra detta.' });
            next();
        };
    }

    return { createSession, deleteSession, purgeExpiredSessions, requireAuth, requireRole };
}

module.exports = { hashPassword, verifyPassword, initSessions };
