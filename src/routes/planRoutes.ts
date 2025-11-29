// src/routes/planRoutes.ts
import { Router } from "express";
import { planController } from "../controllers/planController";
import { planMiddleware } from "../middlewares/planMiddleware";

export const planRouter = Router();

// Sube y procesa un PDF en una sola llamada
planRouter.post("/upload", planMiddleware.single("pdf"), planController.uploadFile);

// Solo parsea y devuelve JSON (sin ingestar)
planRouter.post("/parse-only", planMiddleware.single("pdf"), planController.parseOnly);


export default planRouter;
