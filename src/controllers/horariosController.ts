import type { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { sha256File } from '../utils/fileHash';
import { leerHorariosISI, leerPrelistas } from '../utils/parseHorarios';
import { ingestaHorarios } from '../services/ingestaHorarios';
import { obtenerHistorialHorarios } from '../services/historialHorariosService';

export class HorariosController {
  /**
   * Sube uno o dos archivos de horarios.
   * Campos soportados (multer.fields):
   *  - isi        → archivo de formato ISI
   *  - prelistas  → archivo de formato Prelistas
   *
   * Ambos son opcionales, pero al menos uno debe venir.
   */
  static async uploadAmbos(req: Request, res: Response) {
    try {
      const rawFiles = req.files as
        | { [field: string]: Express.Multer.File[] }
        | Express.Multer.File[]
        | undefined;

      let fISI: Express.Multer.File | undefined;
      let fPre: Express.Multer.File | undefined;

      if (Array.isArray(rawFiles)) {
        // Caso upload.array(...)
        fISI = rawFiles[0];
        fPre = rawFiles[1];
      } else if (rawFiles && typeof rawFiles === 'object') {
        const map = rawFiles as { [field: string]: Express.Multer.File[] };
        fISI = map['isi']?.[0];
        fPre = map['prelistas']?.[0];
      }

      if (!fISI && !fPre) {
        return res.status(400).json({
          ok: false,
          error: 'Debes subir al menos un archivo .xlsx (isi y/o prelistas)',
        });
      }

      let archivoIdISI: number | undefined;
      let archivoIdPre: number | undefined;
      let hashISI: string | undefined;
      let hashPre: string | undefined;

      // 🔹 Guardar ISI (si viene)
      if (fISI) {
        hashISI = await sha256File(fISI.path);
        const insert1 = await AppDataSource.query(
          `INSERT INTO public.archivo_cargado
            (tipo, nombre_archivo, hash, usuario, stored_name, mime_type, size_bytes, storage_path, estado_proceso)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            'HORARIOS_ISI',
            fISI.originalname,
            hashISI,
            'system',
            fISI.filename,
            fISI.mimetype,
            fISI.size,
            fISI.destination,
            'PENDIENTE',
          ],
        );
        archivoIdISI = insert1[0]?.id;

        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'UPLOAD','OK',$2)`,
          [archivoIdISI, `Subida ${fISI.originalname}`],
        );
      }

      // 🔹 Guardar Prelistas (si viene)
      if (fPre) {
        hashPre = await sha256File(fPre.path);
        const insert2 = await AppDataSource.query(
          `INSERT INTO public.archivo_cargado
            (tipo, nombre_archivo, hash, usuario, stored_name, mime_type, size_bytes, storage_path, estado_proceso)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            'HORARIOS_PRELISTAS',
            fPre.originalname,
            hashPre,
            'system',
            fPre.filename,
            fPre.mimetype,
            fPre.size,
            fPre.destination,
            'PENDIENTE',
          ],
        );
        archivoIdPre = insert2[0]?.id;

        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'UPLOAD','OK',$2)`,
          [archivoIdPre, `Subida ${fPre.originalname}`],
        );
      }

      return res.json({
        ok: true,
        isi: archivoIdISI ? { archivoId: archivoIdISI, hash: hashISI } : undefined,
        prelistas: archivoIdPre ? { archivoId: archivoIdPre, hash: hashPre } : undefined,
      });
    } catch (err: any) {
      console.error('Error en uploadAmbos:', err);
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  /**
   * Procesa los archivos previamente subidos.
   * Acepta:
   *  - solo archivoIdISI
   *  - solo archivoIdPrelistas
   *  - ambos
   */
  static async procesar(req: Request, res: Response) {
  const { archivoIdISI, archivoIdPrelistas, periodoEtiqueta } = req.body || {};

  if (!archivoIdISI && !archivoIdPrelistas) {
    return res.status(400).json({
      ok: false,
      error: "Debes enviar archivoIdISI y/o archivoIdPrelistas",
    });
  }

    const ids: number[] = [];
    if (archivoIdISI) ids.push(Number(archivoIdISI));
    if (archivoIdPrelistas) ids.push(Number(archivoIdPrelistas));

    // Usamos uno de los ids (prefiriendo ISI) como base para auditar la ingesta combinada
    const baseIdForAuditoria = archivoIdISI
      ? Number(archivoIdISI)
      : Number(archivoIdPrelistas);

    try {
      // Recuperar rutas físicas desde archivo_cargado
      const rows = await AppDataSource.query(
        `SELECT id, storage_path, stored_name, nombre_archivo, tipo
         FROM public.archivo_cargado
         WHERE id = ANY($1::int[])`,
        [ids],
      );

      const recISI = archivoIdISI
        ? rows.find((r: any) => r.id === Number(archivoIdISI))
        : null;
      const recPre = archivoIdPrelistas
        ? rows.find((r: any) => r.id === Number(archivoIdPrelistas))
        : null;

      if (archivoIdISI && !recISI) {
        throw new Error('No se encontró archivo_cargado para archivoIdISI');
      }
      if (archivoIdPrelistas && !recPre) {
        throw new Error('No se encontró archivo_cargado para archivoIdPrelistas');
      }

      const path = require('path');
      const pathISI =
        recISI && recISI.storage_path && recISI.stored_name
          ? path.join(recISI.storage_path, recISI.stored_name)
          : null;
      const pathPre =
        recPre && recPre.storage_path && recPre.stored_name
          ? path.join(recPre.storage_path, recPre.stored_name)
          : null;

      // Auditoría PARSE INICIO
      if (archivoIdISI) {
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'PARSE','INICIO',$2)`,
          [archivoIdISI, `Parse ${recISI?.nombre_archivo ?? 'ISI'}`],
        );
      }
      if (archivoIdPrelistas) {
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'PARSE','INICIO',$2)`,
          [archivoIdPrelistas, `Parse ${recPre?.nombre_archivo ?? 'Prelistas'}`],
        );
      }

      // Parsear archivos según lo que haya
      const parsedISI = pathISI ? await leerHorariosISI(pathISI) : { rows: [] };
      const parsedPre = pathPre ? await leerPrelistas(pathPre) : { rows: [] };

      // Auditoría PARSE OK
      if (archivoIdISI) {
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'PARSE','OK',$2)`,
          [
            archivoIdISI,
            `Filas ISI: ${parsedISI.rows ? parsedISI.rows.length : 0}`,
          ],
        );
      }
      if (archivoIdPrelistas) {
        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
           VALUES ($1,'PARSE','OK',$2)`,
          [
            archivoIdPrelistas,
            `Filas Prelistas: ${parsedPre.rows ? parsedPre.rows.length : 0}`,
          ],
        );
      }

      // Auditoría INGESTA INICIO (usamos el id base)
      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'INGESTA','INICIO','Ingesta horarios (uno o dos archivos)')`,
        [baseIdForAuditoria],
      );

      const resumen = await ingestaHorarios({
        fromISI: parsedISI.rows || [],
        fromPrelistas: parsedPre.rows || [],
        periodoEtiqueta: periodoEtiqueta ?? null, 
      });

      // marcar completados los que existan
      await AppDataSource.query(
        `UPDATE public.archivo_cargado
         SET estado_proceso = 'COMPLETADO'
         WHERE id = ANY($1::int[])`,
        [ids],
      );

      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'INGESTA','OK',$2)`,
        [
          baseIdForAuditoria,
          `Grupos upsert: ${resumen.gruposUpsert ?? 0}, horarios: ${
            resumen.horariosUpsert ?? 0
          }`,
        ],
      );

      return res.json({ ok: true, resumen });
    } catch (err: any) {
      console.error('Error en procesar horarios:', err);
      // Registrar error en auditoría con el id base que tengamos
      await AppDataSource.query(
        `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
         VALUES ($1,'INGESTA','ERROR',$2)`,
        [baseIdForAuditoria, String(err?.message || err)],
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

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
          dia_semana,
          hora_inicio,
          hora_fin,
          aula,
          num_empleado,
          profesor_nombre,
          profesor_apellido_paterno,
          profesor_apellido_materno,
          cupo
        FROM vista_horarios_grupos
      `;

      if (periodo) {
        sql += ` WHERE periodo = $1`;
        params.push(periodo);
      }

      sql += ` ORDER BY periodo, codigo_materia, grupo, dia_semana, hora_inicio`;

      const rows = await AppDataSource.query(sql, params);

      return res.json({ ok: true, items: rows });
    } catch (err: any) {
      console.error('Error en listarResumen:', err);
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  static async historial(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit || 50);
      const items = await obtenerHistorialHorarios(limit);
      return res.json({ ok: true, items });
    } catch (err: any) {
      console.error('Error al obtener historial de horarios:', err);
      return res.status(500).json({
        ok: false,
        error: 'Error al obtener historial de horarios',
      });
    }
  }

    /**
   * POST /horarios
   * Crea un horario manualmente desde el front.
   */
  static async crearManual(req: Request, res: Response) {
    try {
      const {
        periodo,
        codigo_materia,
        nombre_materia,
        grupo,
        dia_semana,
        aula,
        hora_inicio,
        hora_fin,
        num_empleado,
        profesor_nombre,
        profesor_apellido_paterno,
        profesor_apellido_materno,
        cupo,
      } = req.body || {};

      if (!periodo || !codigo_materia || !nombre_materia || !grupo) {
        return res.status(400).json({
          ok: false,
          error: "Periodo, código, nombre de materia y grupo son obligatorios",
        });
      }

      if (!dia_semana || !hora_inicio || !hora_fin) {
        return res.status(400).json({
          ok: false,
          error: "Día de semana y horas de inicio/fin son obligatorias",
        });
      }

      // 1) Periodo
      const per = await AppDataSource.query(
        `SELECT id FROM public.periodo WHERE etiqueta = $1`,
        [periodo],
      );
      if (!per[0]?.id) {
        return res.status(400).json({
          ok: false,
          error: `No se encontró el periodo con etiqueta ${periodo}`,
        });
      }
      const periodoId = per[0].id;

      // 2) Materia por código
      const mat = await AppDataSource.query(
        `SELECT id, nombre FROM public.materia WHERE codigo = $1`,
        [codigo_materia],
      );
      if (!mat[0]?.id) {
        return res.status(400).json({
          ok: false,
          error: `No se encontró la materia con código ${codigo_materia}`,
        });
      }
      const materiaId = mat[0].id;
      const nombreMateriaFinal = nombre_materia || mat[0].nombre;

      // 3) Grupo: reutilizar si ya existe o crearlo
      const claveGrupo = String(grupo).trim();
      const cupoNum =
        cupo !== undefined && cupo !== null && cupo !== ""
          ? Number(cupo)
          : 0;

      let grupoId: number;
      const g = await AppDataSource.query(
        `SELECT id FROM public.grupo
         WHERE materia_id = $1 AND periodo_id = $2 AND clave_grupo = $3`,
        [materiaId, periodoId, claveGrupo],
      );

      if (g[0]?.id) {
        grupoId = g[0].id;
        if (cupoNum > 0) {
          await AppDataSource.query(
            `UPDATE public.grupo SET cupo = $1 WHERE id = $2`,
            [cupoNum, grupoId],
          );
        }
      } else {
        const insG = await AppDataSource.query(
          `INSERT INTO public.grupo (materia_id, periodo_id, clave_grupo, cupo)
           VALUES ($1,$2,$3,$4)
           RETURNING id`,
          [materiaId, periodoId, claveGrupo, cupoNum],
        );
        grupoId = insG[0].id;
      }

      // 4) Profesor opcional + asignación
      let profesorId: number | null = null;
      let numEmpleadoInt: number | null = null;

      if (num_empleado) {
        numEmpleadoInt = Number(num_empleado);
        if (!Number.isNaN(numEmpleadoInt)) {
          const pr = await AppDataSource.query(
            `SELECT id FROM public.profesor WHERE num_empleado = $1`,
            [numEmpleadoInt],
          );
          if (pr[0]?.id) {
            profesorId = pr[0].id;
          }
          // Si no existe, de momento no lo creamos automáticamente;
          // solo se omite la asignación para no explotar por FK.
        }
      }

      if (grupoId && profesorId) {
        await AppDataSource.query(
          `INSERT INTO public.asignacion_profesor (grupo_id, profesor_id, rol_docente)
           VALUES ($1,$2,'TITULAR')
           ON CONFLICT DO NOTHING`,
          [grupoId, profesorId],
        );
      }

      // 5) Insertar horario (un solo slot)
      const aulaStr = (aula || "S/A").trim();
      const horaInicio =
        String(hora_inicio).length === 5 ? `${hora_inicio}:00` : hora_inicio;
      const horaFin =
        String(hora_fin).length === 5 ? `${hora_fin}:00` : hora_fin;

      const insH = await AppDataSource.query(
        `INSERT INTO public.horario (grupo_id, dia_semana, hora_inicio, hora_fin, aula)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [grupoId, Number(dia_semana), horaInicio, horaFin, aulaStr],
      );
      const horarioId = insH[0].id;

      // 6) Devolver el registro en el mismo formato que vista_horarios_grupos
      const rows = await AppDataSource.query(
        `
        SELECT
          h.id,
          p.etiqueta AS periodo,
          m.codigo AS codigo_materia,
          m.nombre AS nombre_materia,
          g.clave_grupo AS grupo,
          h.dia_semana,
          h.hora_inicio,
          h.hora_fin,
          h.aula,
          pr.num_empleado,
          pr.nombre AS profesor_nombre,
          pr.apellido_paterno AS profesor_apellido_paterno,
          pr.apellido_materno AS profesor_apellido_materno,
          g.cupo
        FROM public.horario h
        JOIN public.grupo g   ON g.id = h.grupo_id
        JOIN public.materia m ON m.id = g.materia_id
        JOIN public.periodo p ON p.id = g.periodo_id
        LEFT JOIN public.asignacion_profesor ap ON ap.grupo_id = g.id
        LEFT JOIN public.profesor pr ON pr.id = ap.profesor_id
        WHERE h.id = $1
        `,
        [horarioId],
      );

      const row = rows[0] || {
        id: horarioId,
        periodo,
        codigo_materia,
        nombre_materia: nombreMateriaFinal,
        grupo: claveGrupo,
        dia_semana: Number(dia_semana),
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        aula: aulaStr,
        num_empleado: numEmpleadoInt,
        profesor_nombre,
        profesor_apellido_paterno,
        profesor_apellido_materno,
        cupo: cupoNum,
      };

      return res.json(row);
    } catch (err: any) {
      console.error("Error al crear horario manual:", err);
      return res.status(500).json({
        ok: false,
        error: "Error interno al crear horario",
      });
    }
  }

  /**
   * PUT /horarios/:id
   * Actualiza un horario existente.
   */
  static async actualizarManual(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: "ID inválido" });
      }

      const {
        periodo,
        codigo_materia,
        nombre_materia,
        grupo,
        dia_semana,
        aula,
        hora_inicio,
        hora_fin,
        num_empleado,
        profesor_nombre,
        profesor_apellido_paterno,
        profesor_apellido_materno,
        cupo,
      } = req.body || {};

      const h = await AppDataSource.query(
        `SELECT * FROM public.horario WHERE id = $1`,
        [id],
      );
      if (!h[0]?.id) {
        return res.status(404).json({
          ok: false,
          error: "Horario no encontrado",
        });
      }
      let grupoId = h[0].grupo_id as number;

      // Opcionalmente actualizar grupo / materia / periodo si vienen en el payload
      if (periodo || codigo_materia || grupo || cupo !== undefined) {
        // Recuperar grupo actual y sus llaves
        const gCur = await AppDataSource.query(
          `SELECT * FROM public.grupo WHERE id = $1`,
          [grupoId],
        );
        if (!gCur[0]?.id) {
          return res.status(500).json({
            ok: false,
            error: "Grupo asociado al horario no encontrado",
          });
        }

        let materiaId = gCur[0].materia_id;
        let periodoId = gCur[0].periodo_id;
        let claveGrupo = gCur[0].clave_grupo;
        let cupoNum = gCur[0].cupo;

        if (periodo) {
          const per = await AppDataSource.query(
            `SELECT id FROM public.periodo WHERE etiqueta = $1`,
            [periodo],
          );
          if (!per[0]?.id) {
            return res.status(400).json({
              ok: false,
              error: `No se encontró el periodo con etiqueta ${periodo}`,
            });
          }
          periodoId = per[0].id;
        }

        if (codigo_materia) {
          const mat = await AppDataSource.query(
            `SELECT id FROM public.materia WHERE codigo = $1`,
            [codigo_materia],
          );
          if (!mat[0]?.id) {
            return res.status(400).json({
              ok: false,
              error: `No se encontró la materia con código ${codigo_materia}`,
            });
          }
          materiaId = mat[0].id;
        }

        if (grupo) claveGrupo = String(grupo).trim();
        if (cupo !== undefined && cupo !== null && cupo !== "")
          cupoNum = Number(cupo);

        await AppDataSource.query(
          `UPDATE public.grupo
           SET materia_id = $1, periodo_id = $2, clave_grupo = $3, cupo = $4
           WHERE id = $5`,
          [materiaId, periodoId, claveGrupo, cupoNum, grupoId],
        );
      }

      // Actualizar horario en sí
      const aulaStr =
        aula !== undefined && aula !== null ? String(aula).trim() : h[0].aula;
      const horaInicio =
        hora_inicio !== undefined && hora_inicio !== null
          ? (String(hora_inicio).length === 5
              ? `${hora_inicio}:00`
              : hora_inicio)
          : h[0].hora_inicio;
      const horaFin =
        hora_fin !== undefined && hora_fin !== null
          ? (String(hora_fin).length === 5 ? `${hora_fin}:00` : hora_fin)
          : h[0].hora_fin;
      const diaSemana =
        dia_semana !== undefined && dia_semana !== null
          ? Number(dia_semana)
          : h[0].dia_semana;

      await AppDataSource.query(
        `UPDATE public.horario
         SET dia_semana = $1, hora_inicio = $2, hora_fin = $3, aula = $4
         WHERE id = $5`,
        [diaSemana, horaInicio, horaFin, aulaStr, id],
      );

      // Profesor opcional
      let profesorId: number | null = null;
      let numEmpleadoInt: number | null = null;
      if (num_empleado) {
        numEmpleadoInt = Number(num_empleado);
        if (!Number.isNaN(numEmpleadoInt)) {
          const pr = await AppDataSource.query(
            `SELECT id FROM public.profesor WHERE num_empleado = $1`,
            [numEmpleadoInt],
          );
          if (pr[0]?.id) {
            profesorId = pr[0].id;
          }
        }
      }

      if (grupoId && profesorId) {
        await AppDataSource.query(
          `INSERT INTO public.asignacion_profesor (grupo_id, profesor_id, rol_docente)
           VALUES ($1,$2,'TITULAR')
           ON CONFLICT DO NOTHING`,
          [grupoId, profesorId],
        );
      }

      // Devolver formato ScheduleRecord
      const rows = await AppDataSource.query(
        `
        SELECT
          h.id,
          p.etiqueta AS periodo,
          m.codigo AS codigo_materia,
          m.nombre AS nombre_materia,
          g.clave_grupo AS grupo,
          h.dia_semana,
          h.hora_inicio,
          h.hora_fin,
          h.aula,
          pr.num_empleado,
          pr.nombre AS profesor_nombre,
          pr.apellido_paterno AS profesor_apellido_paterno,
          pr.apellido_materno AS profesor_apellido_materno,
          g.cupo
        FROM public.horario h
        JOIN public.grupo g   ON g.id = h.grupo_id
        JOIN public.materia m ON m.id = g.materia_id
        JOIN public.periodo p ON p.id = g.periodo_id
        LEFT JOIN public.asignacion_profesor ap ON ap.grupo_id = g.id
        LEFT JOIN public.profesor pr ON pr.id = ap.profesor_id
        WHERE h.id = $1
        `,
        [id],
      );

      const row = rows[0];
      if (!row) {
        return res.status(500).json({
          ok: false,
          error: "No se pudo recuperar el horario actualizado",
        });
      }

      return res.json(row);
    } catch (err: any) {
      console.error("Error al actualizar horario manual:", err);
      return res.status(500).json({
        ok: false,
        error: "Error interno al actualizar horario",
      });
    }
  }

  /**
   * DELETE /horarios/:id
   * Elimina un horario (solo la fila de `horario`).
   */
  static async eliminarManual(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: "ID inválido" });
      }

      await AppDataSource.query(
        `DELETE FROM public.horario WHERE id = $1`,
        [id],
      );

      return res.status(204).send();
    } catch (err: any) {
      console.error("Error al eliminar horario:", err);
      return res.status(500).json({
        ok: false,
        error: "Error interno al eliminar horario",
      });
    }
  }

}
