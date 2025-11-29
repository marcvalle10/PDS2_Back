import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

const uploadsDir = path.join(process.cwd(), 'uploads', 'estructura');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}__${safe}`);
  }
});

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowed = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];
  if (allowed.includes(file.mimetype) || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
    cb(null, true);
  } else {
    cb(new Error('Formato no soportado. Sube un .xlsx/.xls'));
  }
};

export const uploadEstructura = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });
