import { Router } from "express";
import { uploadKardex } from "../middlewares/kardexMiddleware";
import { kardexController } from "../controllers/kardexController";

const router = Router();

router.post("/upload", uploadKardex, kardexController.uploadFile);

export default router;