import { Request, Response } from "express";
import path from "path";
import { runPythonPlan } from "../utils/runPythonPlan";
import { AppDataSource } from "../config/data-source";
import { ArchivoCargado } from "../entities/ArchivoCargado";
import { AuditoriaCargas } from "../entities/AuditoriaCargas";
import { sha256File } from "../utils/fileHash";
import { ingestaPlan } from "../services/ingestaPlan";

export const planController = {
  uploadFile: async (req: Request, res: Response) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No se recibió ningún archivo." });

      const fullPath = path.resolve(req.file.path);
      const hash = await sha256File(fullPath);

      const repoArchivo = AppDataSource.getRepository(ArchivoCargado);
      const repoAud = AppDataSource.getRepository(AuditoriaCargas);

      // Query params
      const force = String(req.query.force ?? "0") === "1";
      const debug = String(req.query.debug ?? "0") === "1";
      const ocr = String(req.query.ocr ?? "0") === "1";
      const usuario = (req.headers["x-usuario"] as string)?.trim() || "system";

      // DEDUP por hash (evita UNIQUE violation ux_archivo_hash)
      const dup = await repoArchivo.findOne({ where: { hash } });

      if (dup && !force) {
        await repoAud.save(
          repoAud.create({
            archivo_id: dup.id,
            etapa: "UPLOAD",
            estado: "OK",
            detalle:
              "Archivo duplicado por hash; no se volvió a insertar (idempotente).",
          })
        );
        return res.json({
          ok: true,
          action: "DUPLICATE_HASH_SKIPPED",
          archivoId: dup.id,
          estado_proceso: dup.estado_proceso,
        });
      }

      // Si no existe (o force=1), crea/usa un registro de archivo
      const nuevo = repoArchivo.create({
        tipo: "PLAN_ESTUDIO",
        nombre_archivo: req.file.originalname,
        hash,
        usuario,
        estado_proceso: "PENDIENTE",
        stored_name: req.file.filename,
        storage_path: fullPath.replace(process.cwd(), ""),
      });

      const saved = dup ?? (await repoArchivo.save(nuevo));
      const archivoId = saved.id;

      await repoAud.save(
        repoAud.create({
          archivo_id: archivoId,
          etapa: "UPLOAD",
          estado: "OK",
          detalle: dup
            ? "FORCE=1: reutilizando archivo existente"
            : `Guardado en ${saved.storage_path}`,
        })
      );

      // 1) Parsear con Python (con flags opcionales)
      const args: string[] = [];
      if (debug) args.push("--debug");
      if (ocr) args.push("--ocr");

      const parsed = await runPythonPlan(fullPath, args);

      await repoAud.save(
        repoAud.create({
          archivo_id: archivoId,
          etapa: "PARSE",
          estado: parsed?.ok ? "OK" : "ERROR",
          detalle: `Plan: ${parsed?.plan?.nombre ?? "?"} v${
            parsed?.plan?.version ?? "?"
          } | Materias: ${parsed?.materias?.length ?? 0}`,
        })
      );

      if (!parsed?.ok) {
        await repoArchivo.update(archivoId, { estado_proceso: "ERROR" });
        return res
          .status(422)
          .json({ ok: false, error: "No se pudo parsear el PDF del plan.", parsed });
      }

      // 2) Ingesta idempotente (solo agrega/actualiza lo nuevo)
      const ingesta = await ingestaPlan(parsed, archivoId);

      await repoAud.save(
        repoAud.create({
          archivo_id: archivoId,
          etapa: "PARSE",
          estado: parsed?.ok ? "OK" : "ERROR",
          detalle: `Plan: ${parsed?.plan?.nombre ?? "?"} v${parsed?.plan?.version ?? "?"} | Materias: ${parsed?.materias?.length ?? 0} | Origen: ${parsed?.origen ?? "?"}`,
        })
      );

      await repoArchivo.update(archivoId, { estado_proceso: "COMPLETADO" });

      return res.json({
        ok: true,
        action: dup && force
          ? "REINGEST_FORCED"
          : dup
          ? "REUSED_EXISTING"
          : "NEW_FILE_INGESTED",
        archivoId,
        parsed,
        ingesta,
      });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message ?? String(e) });
    }
  },

  parseOnly: async (req: Request, res: Response) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No se recibió ningún archivo." });

      const fullPath = path.resolve(req.file.path);
      const debug = String(req.query.debug ?? "0") === "1";
      const ocr = String(req.query.ocr ?? "0") === "1";

      const args: string[] = [];
      if (debug) args.push("--debug");
      if (ocr) args.push("--ocr");

      const parsed = await runPythonPlan(fullPath, args);
      return res.json(parsed);
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message ?? String(e) });
    }
  },
};
