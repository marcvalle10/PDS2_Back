import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

const uploadsDir = path.join(process.cwd(), 'uploads', 'horarios');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}__${safe}`);
  },
});

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ok = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];
  if (ok.includes(file.mimetype) || /\.xlsx?$/i.test(file.originalname)) cb(null, true);
  else cb(new Error('Formato no soportado. Sube un .xlsx/.xls'));
};

export const uploadHorarios = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});
