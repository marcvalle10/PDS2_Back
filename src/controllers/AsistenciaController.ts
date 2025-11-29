// src/controllers/asistenciaController.ts
import type { Request, Response } from 'express';
import path from 'path';
import { AppDataSource } from '../config/data-source';
import { sha256File } from '../utils/fileHash';
import { leerListaAsistencia } from '../utils/parseAsistencia';
import { ingestaAsistencia } from '../services/ingestaAsistencia';
import type { IngestaAsistenciaResumen } from '../services/ingestaAsistencia';


export class AsistenciaController {
  /**
   * 1) Sube el archivo de lista de asistencia
   *    - Lo guarda en disco (multer ya lo hizo)
   *    - Registra en archivo_cargado
   *    - Registra auditoría etapa UPLOAD
   */
  static async upload(req: Request, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          ok: false,
          error: 'Debes subir un archivo .xlsx en el campo "file"',
        });
      }

      const hash = await sha256File(file.path);

      // Registrar archivo en archivo_cargado
      const insert = await AppDataSource.query(
        `INSERT INTO public.archivo_cargado
         (tipo, nombre_archivo, hash, usuario, stored_name, mime_type, size_bytes, storage_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          'ASISTENCIA',
          file.originalname,
          hash,
          // TODO: reemplazar por el usuario autenticado real
          'carga-asistencia',
          file.filename,
          file.mimetype,
          file.size,
          file.destination,
        ]
      );

      const archivoId = insert[0].id as number;

      // Auditoría UPLOAD OK
      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'UPLOAD','OK',$2)`,
        [archivoId, 'Upload de lista de asistencia']
      );

      return res.json({ ok: true, archivoId });
    } catch (e) {
      console.error('[AsistenciaController.upload] Error:', e);
      return res.status(500).json({
        ok: false,
        error: 'Error subiendo archivo de asistencia',
      });
    }
  }

  /**
   * 2) Procesa un archivo de asistencia ya subido:
   *    - Localiza el archivo en archivo_cargado
   *    - Parsea la lista (parseAsistencia)
   *    - Ejecuta ingestaAsistencia (alumno_grupo + inscripcion)
   *    - Registra auditorías PARSE / INGESTA
   */
  static async process(req: Request, res: Response) {
    const archivoId = Number(req.params.archivoId);
    const periodoEtiqueta = (req.body?.periodoEtiqueta ||
      req.query?.periodoEtiqueta) as string | undefined;

    if (!archivoId || Number.isNaN(archivoId)) {
      return res.status(400).json({
        ok: false,
        error: 'archivoId inválido',
      });
    }

    if (!periodoEtiqueta) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar periodoEtiqueta (ej. "2025-1")',
      });
    }

    try {
      // 1) Buscar archivo_cargado para obtener la ruta física
      const rows = await AppDataSource.query(
        `SELECT stored_name, storage_path
         FROM public.archivo_cargado
         WHERE id = $1`,
        [archivoId]
      );

      const row = rows[0];
      if (!row) {
        return res.status(404).json({
          ok: false,
          error: 'archivo_cargado no encontrado',
        });
      }

      const fullPath = path.join(row.storage_path, row.stored_name);

      // Auditoría PARSE inicio
      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'PARSE','EN_PROCESO',$2)`,
        [archivoId, 'Parse de lista de asistencia']
      );

      // 2) Parsear Excel → meta + filas
      const { meta, rows: filas } = leerListaAsistencia(fullPath);

      if (!filas.length) {
        // Auditoría PARSE sin datos
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'PARSE','WARN',$2)`,
          [archivoId, 'El archivo de asistencia no contiene filas de alumnos.']
        );

        return res.status(400).json({
          ok: false,
          error: 'El archivo de asistencia no contiene filas de alumnos.',
        });
      }

      // 3) Ingesta en BD (alumno_grupo + inscripcion)
      const resumen: IngestaAsistenciaResumen = await ingestaAsistencia(
        filas,
        meta,
        archivoId,
        periodoEtiqueta
      );

      // Auditoría INGESTA OK
      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'INGESTA','OK',$2)`,
        [archivoId, JSON.stringify(resumen)]
      );

      // Actualizar estado_proceso → COMPLETADO
      await AppDataSource.query(
        `UPDATE public.archivo_cargado
         SET estado_proceso = 'COMPLETADO'
         WHERE id = $1`,
        [archivoId]
      );

      return res.json({ ok: true, resumen });
    } catch (e: any) {
      console.error('[AsistenciaController.process] Error:', e);

      const msg = e?.message || String(e);

      // Auditoría INGESTA ERROR
      try {
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'INGESTA','ERROR',$2)`,
          [archivoId, msg]
        );

        await AppDataSource.query(
          `UPDATE public.archivo_cargado
           SET estado_proceso = 'ERROR'
           WHERE id = $1`,
          [archivoId]
        );
      } catch (auditErr) {
        console.error(
          '[AsistenciaController.process] Error registrando auditoría:',
          auditErr
        );
      }

      return res.status(500).json({
        ok: false,
        error: 'Error procesando lista de asistencia',
        detalle: msg,
      });

    }
  
  }

 /**
   * 3) Lista el resumen de relaciones alumno–grupo–materia
   *    a partir de la vista vista_asistencia_grupos.
   *
   *    GET /asistencia/resumen?periodo=2026-1
   */

  static async listarResumen(req: Request, res: Response) {
    try {
      const { periodo } = req.query;

      const params: any[] = [];
      let sql = `
        SELECT
          periodo,
          codigo_materia,
          nombre_materia,
          grupo,
          matricula,
          expediente,
          nombre_alumno,
          apellido_paterno,
          apellido_materno,
          fecha_alta,
          fuente,
          archivo_id,
          nombre_archivo,
          fecha_archivo
        FROM public.vista_asistencia_grupos
      `;

      if (periodo) {
        sql += ` WHERE periodo = $1`;
        params.push(periodo);
      }

      sql += `
        ORDER BY periodo, codigo_materia, grupo, matricula
      `;

      const rows = await AppDataSource.query(sql, params);

      return res.json({ ok: true, items: rows });
    } catch (err) {
      console.error("Error en listarResumen de asistencia:", err);
      return res.status(500).json({
        ok: false,
        error: "Error al obtener resumen de asistencia",
      });
    }
  }

      /**
     * POST /asistencia
     * Crea una relación alumno–grupo manualmente desde el front.
     * Body esperado (Partial<AttendanceRecord>):
     * {
     *   periodo, codigo_materia, grupo, matricula,
     *   nombre_materia?, nombre_alumno?, apellido_paterno?, apellido_materno?
     * }
     */
    static async crearManual(req: Request, res: Response) {
    try {
      const {
        periodo,
        codigo_materia,
        grupo,
        matricula,
        nombre_materia,
      } = req.body || {};

      const periodoEtiqueta = (periodo || "").trim();
      const codigo = (codigo_materia || "").trim();
      const claveGrupo = (grupo || "").trim();
      const matriculaRaw = (matricula || "").trim();

      if (!periodoEtiqueta || !codigo || !claveGrupo || !matriculaRaw) {
        return res.status(400).json({
          ok: false,
          error:
            "Periodo, código de materia, grupo y matrícula son obligatorios",
        });
      }

      // ✅ Soportar varias matrículas separadas por coma
      const matriculas: string[] = matriculaRaw
        .split(",")
        .map((m: string) => m.trim())
        .filter((m: string) => m.length > 0);

      if (matriculas.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No se proporcionó ninguna matrícula válida.",
        });
      }

      // 1) Periodo (común para todos)
      const perRows = await AppDataSource.query(
        `SELECT id FROM public.periodo WHERE etiqueta = $1`,
        [periodoEtiqueta]
      );
      const periodoRow = perRows[0];
      if (!periodoRow?.id) {
        return res.status(400).json({
          ok: false,
          error: `No se encontró el periodo con etiqueta "${periodoEtiqueta}".`,
        });
      }
      const periodoId: number = periodoRow.id;

      // 2) Materia (común para todos)
      const matRows = await AppDataSource.query(
        `SELECT id, nombre FROM public.materia WHERE codigo = $1`,
        [codigo]
      );
      const matRow = matRows[0];
      if (!matRow?.id) {
        return res.status(400).json({
          ok: false,
          error: `No se encontró la materia con código "${codigo}".`,
        });
      }
      const materiaId: number = matRow.id;

      // 3) Grupo (común para todos)
      const gRows = await AppDataSource.query(
        `SELECT id
        FROM public.grupo
        WHERE materia_id = $1 AND periodo_id = $2 AND clave_grupo = $3`,
        [materiaId, periodoId, claveGrupo]
      );
      const gRow = gRows[0];
      if (!gRow?.id) {
        return res.status(400).json({
          ok: false,
          error: `No se encontró el grupo "${claveGrupo}" para la materia "${codigo}" en el periodo "${periodoEtiqueta}".`,
        });
      }
      const grupoId: number = gRow.id;

      const resultados: any[] = [];

      // 4) Procesar cada matrícula
      for (const mat of matriculas) {
        // 4.1 Alumno por matrícula
        const alumRows = await AppDataSource.query(
          `SELECT id, expediente, nombre, apellido_paterno, apellido_materno
          FROM public.alumno
          WHERE matricula = $1`,
          [mat]
        );
        const alumno = alumRows[0];
        if (!alumno?.id) {
          // Si prefieres all-or-nothing, puedes lanzar error aquí.
          // Por ahora, saltamos la matrícula que no exista.
          console.warn(`Alumno con matrícula "${mat}" no encontrado, se omite.`);
          continue;
        }
        const alumnoId: number = alumno.id;

        // 4.2 Inscripción al periodo
        const insRows = await AppDataSource.query(
          `SELECT 1
          FROM public.inscripcion
          WHERE alumno_id = $1 AND periodo_id = $2`,
          [alumnoId, periodoId]
        );
        if (!insRows[0]) {
          await AppDataSource.query(
            `INSERT INTO public.inscripcion (alumno_id, periodo_id, estatus)
            VALUES ($1,$2,'INSCRITO')`,
            [alumnoId, periodoId]
          );
        }

        // 4.3 Relación en alumno_grupo
        const agRows = await AppDataSource.query(
          `SELECT id
          FROM public.alumno_grupo
          WHERE alumno_id = $1 AND grupo_id = $2`,
          [alumnoId, grupoId]
        );
        if (!agRows[0]?.id) {
          await AppDataSource.query(
            `INSERT INTO public.alumno_grupo (alumno_id, grupo_id, archivo_id, fuente)
            VALUES ($1,$2,$3,'MANUAL')`,
            [alumnoId, grupoId, null]
          );
        }

        // 4.4 Buscar registro en la vista para esa matrícula
        const rows = await AppDataSource.query(
          `
          SELECT
            periodo,
            codigo_materia,
            nombre_materia,
            grupo,
            matricula,
            expediente,
            nombre_alumno,
            apellido_paterno,
            apellido_materno,
            fecha_alta,
            fuente,
            archivo_id,
            nombre_archivo,
            fecha_archivo
          FROM public.vista_asistencia_grupos
          WHERE periodo = $1
            AND codigo_materia = $2
            AND grupo = $3
            AND matricula = $4
          ORDER BY fecha_alta DESC
          LIMIT 1
          `,
          [periodoEtiqueta, codigo, claveGrupo, mat]
        );

        const row = rows[0];

        if (row) {
          resultados.push(row);
        } else {
          // Fallback por si la vista aún no refleja el cambio
          resultados.push({
            periodo: periodoEtiqueta,
            codigo_materia: codigo,
            nombre_materia: nombre_materia || matRow.nombre || "",
            grupo: claveGrupo,
            matricula: mat,
            expediente: alumno.expediente ?? null,
            nombre_alumno: alumno.nombre,
            apellido_paterno: alumno.apellido_paterno,
            apellido_materno: alumno.apellido_materno ?? null,
            fecha_alta: new Date().toISOString(),
            fuente: "MANUAL",
            archivo_id: null,
            nombre_archivo: null,
            fecha_archivo: null,
          });
        }
      }

      if (resultados.length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            "No se creó ninguna relación de asistencia. Revisa que las matrículas existan.",
        });
      }

      // ✅ El front recibirá SIEMPRE un arreglo
      return res.json(resultados);
    } catch (err) {
      console.error("Error al crear relación de asistencia manual:", err);
      return res.status(500).json({
        ok: false,
        error: "Error interno al crear relación de asistencia",
      });
    }
  }

}

