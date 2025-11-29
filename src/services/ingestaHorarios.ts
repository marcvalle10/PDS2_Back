import { AppDataSource } from '../config/data-source';
import { NormalizedHorario, Dia } from '../utils/parseHorarios';

interface Payload {fromISI: any[];fromPrelistas: any[];periodoEtiqueta?: string | null;}
const DIA_MAP: Record<Dia, number> = { LUN:1, MAR:2, MIE:3, JUE:4, VIE:5, SAB:6 };

function cicloToFechas(etiqueta: string) {
  const m = etiqueta.match(/^(\d{4})-(1|2)$/);
  if (!m) return { ini: '2000-01-01', fin: '2000-06-30' };
  const y = Number(m[1]); const c = Number(m[2]);
  if (c === 1) return { ini: `${y}-01-15`, fin: `${y}-06-30` };
  return { ini: `${y}-08-01`, fin: `${y}-12-20` };
}

function splitNombre(nombre?: string | null) {
  const full = (nombre || '').trim();
  if (!full) return { nombre:'SIN', apPat:'NOMBRE', apMat:null };
  const partes = full.split(/\s+/);
  if (partes.length === 1) return { nombre: partes[0], apPat: 'S/A', apMat: null };
  if (partes.length === 2) return { nombre: partes[0], apPat: partes[1], apMat: null };
  const apMat = partes.pop()!;
  const apPat = partes.pop()!;
  return { nombre: partes.join(' '), apPat, apMat };
}

function inferPeriodoActualEtiqueta(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Ajusta esto a como manejen los ciclos en tu depto
  const ciclo = month >= 1 && month <= 6 ? 1 : 2;
  return `${year}-${ciclo}`; // ej. "2025-1" o "2025-2"
}

async function ensureUsuarioProfesor(correo: string): Promise<number> {
  // 1) ¿Ya existe usuario con ese correo?
  const existing = await AppDataSource.query(
    `SELECT id FROM public.usuario WHERE email = $1`,
    [correo]
  );

  let userId: number;

  if (existing[0]?.id) {
    userId = existing[0].id;
  } else {
    // 2) Crear usuario "básico" para el profesor
    const insUser = await AppDataSource.query(
      `INSERT INTO public.usuario (email, password_hash, activo)
       VALUES ($1,$2,true)
       RETURNING id`,
      [correo, 'TEMPORAL'] // puedes cambiar 'TEMPORAL' luego por un hash real
    );
    userId = insUser[0].id;
  }

  // 3) (Opcional pero recomendado) Asignar rol PROFESOR si existe
  try {
    const r = await AppDataSource.query(
      `SELECT id FROM public.rol WHERE nombre = 'PROFESOR'`
    );
    const rolId = r[0]?.id;

    if (rolId) {
      await AppDataSource.query(
        `INSERT INTO public.usuario_rol (usuario_id, rol_id)
         VALUES ($1,$2)
         ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
        [userId, rolId]
      );
    }
  } catch (e) {
    console.warn('No se pudo asignar rol PROFESOR:', e);
  }

  return userId;
}


export async function ingestaHorarios(payload: Payload) {
  // 1) determinar periodo por etiqueta
  const etiqueta =
  (payload.periodoEtiqueta && payload.periodoEtiqueta.trim()) ||
  payload.fromPrelistas.find((r) => r.periodo)?.periodo ||
  payload.fromISI.find((r) => r.periodo)?.periodo ||
  inferPeriodoActualEtiqueta();

let periodoId: number | null = null;

// A partir de aquí usas "etiqueta" normalito como antes
const found = await AppDataSource.query(
  `SELECT id FROM public.periodo WHERE etiqueta=$1`,
  [etiqueta]
);

if (found[0]?.id) {
  periodoId = found[0].id;
} else {
  const m = etiqueta.match(/^(\d{4})-(1|2)$/);
  const anio = m ? Number(m[1]) : new Date().getFullYear();
  const ciclo = m ? Number(m[2]) : 1;
  const { ini, fin } = cicloToFechas(etiqueta);

  const ins = await AppDataSource.query(
    `INSERT INTO public.periodo (anio, ciclo, etiqueta, fecha_inicio, fecha_fin)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [anio, ciclo, etiqueta, ini, fin]
  );
  periodoId = ins[0]?.id ?? null;
}

   if (!periodoId) {
    throw new Error(
      'No se pudo determinar el periodo de los horarios. ' +
        'Sube al menos un archivo que incluya el ciclo (por ejemplo Prelistas con "2025-1").'
    );
  }

  // 2) Mezclar ISI + Prelistas
  type Key = string;
  const keyFor = (r: NormalizedHorario): Key =>
    [etiqueta || r.periodo || 'NA', (r.nombreMateria || '').toUpperCase(), r.grupo || 'G', r.nrc || 'NRC'].join('||');

  const map = new Map<Key, NormalizedHorario>();
  for (const r of payload.fromPrelistas) map.set(keyFor(r), r);

  for (const r of payload.fromISI) {
    const candidates = [...map.entries()].filter(([_k, v]) =>
      (v.nombreMateria || '').toUpperCase() === (r.nombreMateria || '').toUpperCase()
    );
    let merged = false;
    for (const [k, base] of candidates) {
      if ((!base.slots?.length && r.slots?.length) || (!base.aula && r.aula) || (!base.profesor && r.profesor)) {
        if (!base.slots?.length && r.slots?.length) base.slots = r.slots;
        if (!base.aula && r.aula) base.aula = r.aula;
        if (!base.profesor && r.profesor) base.profesor = r.profesor;
        map.set(k, base);
        merged = true;
        break;
      }
    }
    if (!merged) {
      const k = keyFor({ ...r, periodo: etiqueta || r.periodo || null });
      if (!map.has(k)) map.set(k, { ...r, periodo: etiqueta || r.periodo || null });
    }
  }

  // 3) Upserts
  let gruposUpsert = 0;
  let horariosUpsert = 0;
  let profCre = 0;
  let profUpd = 0;
  const materiasSaltadas: string[] = [];

  for (const [_k, r] of map) {
    // --- 3.1 Resolver materia ---
    let materiaId: number | null = null;

    // por código
    if (r.codigoMateria) {
      const m1 = await AppDataSource.query(
        `SELECT id FROM public.materia WHERE codigo=$1`,
        [r.codigoMateria]
      );
      if (m1[0]?.id) materiaId = m1[0].id;
    }
    // por nombre
    if (!materiaId && r.nombreMateria && r.nombreMateria !== '(sin nombre)') {
      const m2 = await AppDataSource.query(
        `SELECT id FROM public.materia WHERE upper(nombre)=upper($1)`,
        [r.nombreMateria]
      );
      if (m2[0]?.id) materiaId = m2[0].id;
    }

    // si no encontramos materia => la saltamos y seguimos
    if (!materiaId) {
      const etiquetaMat = r.codigoMateria || r.nombreMateria || '(desconocida)';
      materiasSaltadas.push(etiquetaMat);
      // podrías también registrar en validacion_resultado si quieres
      continue;
    }

    // --- 3.2 Profesor ---
    let profesorId: number | null = null;
    if (r.noEmpleado) {
      const p1 = await AppDataSource.query(
        `SELECT id FROM public.profesor WHERE num_empleado=$1`,
        [Number(r.noEmpleado)]
      );
      if (p1[0]?.id) {
        profesorId = p1[0].id;
      } else {
        const { nombre, apPat, apMat } = splitNombre(r.profesor);
        const correo = `${r.noEmpleado}@unison.mx`;

        // 👇 crear / obtener usuario y rol PROFESOR
        const usuarioId = await ensureUsuarioProfesor(correo);

        const ins = await AppDataSource.query(
          `INSERT INTO public.profesor (nombre, apellido_paterno, apellido_materno, correo, num_empleado, usuario_id)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [nombre, apPat, apMat, correo, Number(r.noEmpleado), usuarioId]
        );
        profesorId = ins[0]?.id ?? null;
        if (profesorId) profCre++;
      }

    } else if (r.profesor) {
        const { nombre, apPat, apMat } = splitNombre(r.profesor);
        const p2 = await AppDataSource.query(
          `SELECT id FROM public.profesor
          WHERE upper(nombre)=upper($1) AND upper(apellido_paterno)=upper($2)`,
          [nombre, apPat]
        );
        if (p2[0]?.id) {
          profesorId = p2[0].id;
        } else {
          const correo = `sin_empleado_${Date.now()}@unison.mx`;

          // 👇 crear / obtener usuario y rol PROFESOR
          const usuarioId = await ensureUsuarioProfesor(correo);

          const ins = await AppDataSource.query(
            `INSERT INTO public.profesor (nombre, apellido_paterno, apellido_materno, correo, num_empleado, usuario_id)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [nombre, apPat, apMat, correo, Math.floor(Math.random()*1e9), usuarioId]
          );
          profesorId = ins[0]?.id ?? null;
          if (profesorId) profCre++;
        }
      }

    // --- 3.3 Grupo ---
    const claveGrupo = r.nrc || r.grupo || `AUTOGRP-${Buffer.from((r.nombreMateria + (r.aula || '')).toUpperCase()).toString('base64').slice(0,8)}`;
    const cupo = r.inscritos ?? 0;

    let grupoId: number | null = null;
    const g0 = await AppDataSource.query(
      `SELECT id FROM public.grupo WHERE periodo_id=$1 AND materia_id=$2 AND clave_grupo=$3`,
      [periodoId, materiaId, claveGrupo]
    );
    if (g0[0]?.id) {
      grupoId = g0[0].id;
      await AppDataSource.query(
        `UPDATE public.grupo SET cupo=$2 WHERE id=$1`,
        [grupoId, cupo]
      );
    } else {
      const insG = await AppDataSource.query(
        `INSERT INTO public.grupo (materia_id, periodo_id, clave_grupo, cupo)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [materiaId, periodoId, claveGrupo, cupo]
      );
      grupoId = insG[0]?.id ?? null;
    }
    if (grupoId) gruposUpsert++;

    // --- 3.4 Asignación profesor ---
    if (grupoId && profesorId) {
      const asg = await AppDataSource.query(
        `SELECT id FROM public.asignacion_profesor WHERE grupo_id=$1 AND profesor_id=$2`,
        [grupoId, profesorId]
      );
      if (!asg[0]?.id) {
        await AppDataSource.query(
          `INSERT INTO public.asignacion_profesor (grupo_id, profesor_id, rol_docente)
           VALUES ($1,$2,'TITULAR')`,
          [grupoId, profesorId]
        );
      }
    }

    // --- 3.5 Horarios ---
    if (grupoId) {
      await AppDataSource.query(
        `DELETE FROM public.horario WHERE grupo_id=$1`,
        [grupoId]
      );
      for (const s of r.slots || []) {
        const dia = DIA_MAP[s.dia];
        const aula = r.aula?.trim() || 'S/A';
        await AppDataSource.query(
          `INSERT INTO public.horario (grupo_id, dia_semana, hora_inicio, hora_fin, aula)
           VALUES ($1,$2,$3,$4,$5)`,
          [grupoId, dia, s.horaInicio + ':00', s.horaFin + ':00', aula]
        );
        horariosUpsert++;
      }
    }
  }

  return {
    ok: true,
    gruposUpsert,
    horariosUpsert,
    profCre,
    profUpd,
    materiasSaltadas,  // info extra por si la quieres loguear
  };
}
