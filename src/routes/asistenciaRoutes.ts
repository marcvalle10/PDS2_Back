import { Router } from 'express';
import { AsistenciaController } from '../controllers/AsistenciaController';
import { asistenciaUpload } from '../middlewares/asistenciaMiddleware';

const router = Router();

/**
 * Crea una relación alumno–grupo de forma manual
 * POST /asistencia
 */
router.post('/', AsistenciaController.crearManual);

/**
 * Sube archivo de lista de asistencia
 * POST /asistencia/upload
 */
router.post('/upload', asistenciaUpload, AsistenciaController.upload);

/**
 * Procesa archivo de lista de asistencia
 * POST /asistencia/process/:archivoId
 */
router.post('/process/:archivoId', AsistenciaController.process);

/**
 * Resumen de relaciones alumno–grupo–materia
 * GET /asistencia/resumen?periodo=2026-1
 */
router.get('/resumen', AsistenciaController.listarResumen);

export default router;
