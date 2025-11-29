import { Router } from 'express';
import { uploadEstructura } from '../middlewares/estructuraMiddleware';
import { EstructuraController } from '../controllers/estructuraController';

const router = Router();

// Descarga de plantilla opcional
router.get('/plantillas/estructura.xlsx', EstructuraController.descargarPlantilla);

// 1) Subir archivo Excel -> crea ArchivoCargado + auditorías
router.post('/estructura/upload', uploadEstructura.single('file'), EstructuraController.upload);

// 2) Procesar archivo subido -> parsea Excel y hace upsert a DB
router.post('/estructura/process/:archivoId', EstructuraController.procesar);



export default router;
