// src/middlewares/asistenciaMiddleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads', 'asistencia');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || '.xlsx';
    cb(null, `asistencia_${ts}${ext}`);
  },
});

export const asistenciaUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file'); // field "file"
