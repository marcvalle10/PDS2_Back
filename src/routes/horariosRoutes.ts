import { Router } from "express";
import { uploadHorarios } from "../middlewares/horariosMiddleware";
import { HorariosController } from "../controllers/horariosController";

const router = Router();

/**
 * Sube uno o dos archivos (ISI y/o Prelistas)
 * POST /horarios/upload
 */
router.post(
  "/upload",
  uploadHorarios.fields([
    { name: "isi", maxCount: 1 },
    { name: "prelistas", maxCount: 1 },
  ]),
  HorariosController.uploadAmbos
);

// Alias en español (si lo usas en el front)
router.post("/procesar", HorariosController.procesar);

// Alias en inglés para que funcione el script
router.post("/process", HorariosController.procesar);

router.get("/resumen", HorariosController.listarResumen);
router.get("/historial", HorariosController.historial);

/* 🔹 CRUD manual usado por el front de horarios */
router.post("/", HorariosController.crearManual);
router.put("/:id", HorariosController.actualizarManual);
router.delete("/:id", HorariosController.eliminarManual);

export default router;
