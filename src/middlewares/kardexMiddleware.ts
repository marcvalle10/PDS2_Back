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
        const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "-");
        cb(null, `${timestamp}_${safeName}`);
    }
});

const allowedMimeTypes = ["application/pdf"];

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
    if(!allowedMimeTypes.includes(file.mimetype)) {
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