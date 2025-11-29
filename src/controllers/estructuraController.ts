import type { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { ArchivoCargado } from '../entities/ArchivoCargado';
import { AuditoriaCargas } from '../entities/AuditoriaCargas';
import { sha256File } from '../utils/fileHash';   // <- usa el nombre correcto
import { leerExcelEstructura } from '../utils/parseEstructura';
import { ingestaEstructura } from '../services/ingestaEstructura';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export class EstructuraController {
  static async descargarPlantilla(_req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_estructura.xlsx"');
    return res.status(204).end();
  }

  static async upload(req: Request, res: Response) {
     if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
    console.log('EstructuraController.upload HIT — NUEVA VERSION');
    if ((req.body && 'estado_proceso' in req.body) || (req as any).estado_proceso) {
      return res.status(400).json({ error: 'estado_proceso no permitido en upload' });
    }

    if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });

    const repoAud = AppDataSource.getRepository(AuditoriaCargas);

    const filePath = req.file.path;
    const hash     = await sha256File(filePath);
    const size     = req.file.size;

    // 👇 INSERT *crudo* sin estado_proceso para que aplique DEFAULT 'PENDIENTE'
    const sql = `
  INSERT INTO public.archivo_cargado
    (tipo, nombre_archivo, stored_name, mime_type, size_bytes, storage_path, hash, usuario)
  VALUES
    ($1,   $2,             $3,          $4,       $5,          $6,           $7,   $8)
  RETURNING id, estado_proceso
`;
const params = [
  'ESTRUCTURA_EXCEL',
  req.file.originalname,
  req.file.filename ?? null,
  req.file.mimetype ?? null,
  size ?? null,
  filePath,
  hash,
  (req as any).user?.email ?? req.ip ?? 'system',
];

const rows = await AppDataSource.query(sql, params);
const archivoId: number = rows[0].id;
const estado: string = rows[0].estado_proceso;

console.log('archivo_cargado INSERT -> id:', archivoId, 'estado_proceso:', estado);


        await AppDataSource.query(
          `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
          VALUES ($1, $2, $3, $4)`,
          [archivoId, 'UPLOAD', 'OK', `Archivo subido (${req.file.size ?? 0} bytes)`]
        );

    return res.json({ ok: true, archivoId, estado_proceso: estado });
  }

 static async procesar(req: Request, res: Response) {
   if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  const archivoId = Number(req.params.archivoId);
  if (!archivoId) return res.status(400).json({ error: 'archivoId inválido' });

  const repoArchivo = AppDataSource.getRepository(ArchivoCargado);
  const repoAud = AppDataSource.getRepository(AuditoriaCargas);

  const archivo = await repoArchivo.findOne({ where: { id: archivoId } });
  if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

  try {
    // PARSE - INICIO
    await AppDataSource.query(
      `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
       VALUES ($1, $2, $3, $4)`,
      [archivo.id, 'PARSE', 'INICIO', null]
    );

    // Leer archivo
    const filePath = archivo.storage_path;
    if (!filePath) throw new Error('storage_path vacío en ArchivoCargado');

    const { rows } = leerExcelEstructura(filePath);

    // PARSE - OK
    await AppDataSource.query(
      `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
       VALUES ($1, $2, $3, $4)`,
      [archivo.id, 'PARSE', 'OK', `Filas leídas: ${rows.length}`]
    );

    // INGESTA (aquí se crea "resultado")
    const resultado = await ingestaEstructura(rows, archivo.id);

    // INGESTA - OK (ya puedes usar "resultado")
    await AppDataSource.query(
      `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
       VALUES ($1, $2, $3, $4)`,
      [archivo.id, 'INGESTA', 'OK',
       `upserts: alumnos=${resultado.alumnosUpsert}, planes=${resultado.planesUpsert}, warnings=${resultado.warnings.length}`]
    );

    // Estado final del archivo (opcional, permitido por tu CHECK)
    archivo.estado_proceso = 'COMPLETADO';
    await repoArchivo.save(archivo);

    return res.json({ ok: true, resumen: resultado });
  } catch (err: any) {
    await AppDataSource.query(
      `INSERT INTO public.auditoria_cargas (archivo_id, etapa, estado, detalle)
       VALUES ($1, $2, $3, $4)`,
      [archivo.id, 'INGESTA', 'FALLA', String(err?.message || err)]
    );
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}

}
