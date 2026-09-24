const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); }
});

// Vitlista över filändelser som faktiskt används i systemet (produkt-/omslagsbilder,
// kunskapsbank-PDF:er, ordrars bilder/dokument, företagslogga) - INGET annat tillåts. Utan
// detta kunde vem som helst med inloggning ladda upp t.ex. en .svg eller .html-fil till
// public/uploads (som serveras direkt av webbläsaren) och få den att köra som skript/HTML i
// appens eget ursprung - en klassisk lagrad XSS-väg via filuppladdning.
const ALLOWED_UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_UPLOAD_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase()))
});

module.exports = { upload, uploadDir };
