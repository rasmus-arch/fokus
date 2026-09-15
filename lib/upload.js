const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// Separat, EJ publikt serverad mapp för känsligt material (kundens legitimationsfoto vid digital
// offertsignering) - till skillnad från public/uploads exponeras den här mappen inte av
// express.static, bara via en inloggningsskyddad rutt (GET /api/quotes/:id/id-photo i server.js).
const privateUploadDir = path.join(__dirname, '..', 'private_uploads', 'id_photos');
if (!fs.existsSync(privateUploadDir)) fs.mkdirSync(privateUploadDir, { recursive: true });

const privateStorage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, privateUploadDir); },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); }
});
const uploadIdPhoto = multer({
    storage: privateStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});

module.exports = { upload, uploadDir, uploadIdPhoto, privateUploadDir };
