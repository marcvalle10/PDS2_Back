// src/services/historialHorariosService.ts
import { AppDataSource } from '../config/data-source';

export interface HorariosHistorialItem {
  id: number;
  fecha: string;          // ISO string, el front ya la formatea
  nombre_archivo: string;
  estado: string;         // "Válido" | "Rechazado" | "Pendiente"
}

export async function obtenerHistorialHorarios(
  limit = 50,
): Promise<HorariosHistorialItem[]> {
  const rows = await AppDataSource.query(
    `
    SELECT
      ac.id,
      ac.fecha,
      ac.nombre_archivo,
      ac.estado_proceso,
      EXISTS (
        SELECT 1
        FROM public.auditoria_cargas aud
        WHERE aud.archivo_id = ac.id
          AND aud.etapa IN ('VALIDACION','INGESTA')
          AND UPPER(aud.estado) LIKE '%ERROR%'
      ) AS tiene_error
    FROM public.archivo_cargado ac
    WHERE ac.tipo IN ('HORARIOS_ISI', 'HORARIOS_PRELISTAS')
    ORDER BY ac.fecha DESC
    LIMIT $1
    `,
    [limit],
  );

  return (rows as any[]).map((r) => {
    let estado = 'Pendiente';

    if (r.estado_proceso === 'COMPLETADO' && !r.tiene_error) {
      estado = 'Válido';
    } else if (
      r.estado_proceso === 'ERROR' ||
      r.estado_proceso === 'CANCELADO' ||
      r.tiene_error
    ) {
      estado = 'Rechazado';
    }

    return {
      id: r.id,
      fecha: r.fecha,
      nombre_archivo: r.nombre_archivo,
      estado,
    };
  });
}
