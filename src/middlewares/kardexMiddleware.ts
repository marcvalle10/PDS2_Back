import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const timestamp = Date.now();
        // Permitir letras Unicode (acentos/ñ), dígitos, _ . - y espacios
        // Reemplazar únicamente caracteres realmente problemáticos para FS
        const safeName = file.originalname
          .replace(/[^\p{L}\p{N}_.\- ]/gu, "-")
          .replace(/\s+/g, " ")
          .trim();
        cb(null, `${timestamp}_${safeName}`);
 }
});

const allowedMimeTypes = ["application/pdf", "application/octet-stream"]; // algunos navegadores mandan octet-stream

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
    if(!allowedMimeTypes.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith(".pdf")) {
        cb(new Error('Solo se permiten archivos PDF'));
    }
    cb(null, true);
};

const upload = multer ({
    storage, 
    fileFilter,
    limits: {fileSize: 5 * 1024 * 1024 },
});

export const uploadKardex = upload.single('file');