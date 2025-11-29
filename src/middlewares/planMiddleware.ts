import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(process.cwd(), "uploads", "plan");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.parse(file.originalname).name.normalize("NFC").replace(/\s+/g, "_");
    cb(null, `${base}__${ts}${path.extname(file.originalname)}`);
  },
});

export const planMiddleware = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf" && !file.originalname.toLowerCase().endsWith(".pdf")) {
      return cb(new Error("Solo se aceptan archivos PDF"));
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});
