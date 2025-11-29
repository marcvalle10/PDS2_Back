import { AppDataSource } from "../config/data-source";
import { Alumno } from "../entities/Alumno";
import { Materia } from "../entities/Materia";
import { PlanEstudio } from "../entities/PlanEstudio";
import { Periodo } from "../entities/Periodo";
import { Kardex } from "../entities/Kardex";

type KardexMateria = {
    CR: string; CVE: string; Materia: string;
    E1: string | null; E2: string | null; ORD: string | null; REG: string | null;
    CIC: string; I: string | null; R: string | null; B: string | null;
};

type KardexPayload = {
    ok: boolean;
    alumno: {
        fecha: string; programa: string; plan: string; unidad: string;
        expediente: string; alumno: string; estatus: string;
    };
    materias: KardexMateria[];
    resumen?: any;
};

// --- helpers ---
const NFC = (s: string) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

const decodeCIC = (cic: string) => {
    const str = String(cic ?? "").trim();
    if (!/^\d{4}$/.test(str)) throw new Error(`CIC inválido: ${cic}`);
    const yy = parseInt(str.slice(0, 2), 10);
    const ciclo = parseInt(str.slice(3, 4), 10);
    const anio = 2000 + yy;
    return { anio, ciclo, etiqueta: `${anio}-${ciclo}` };
};

const parseGrade = (ord: string | null) => {
    if (!ord) return { calificacion: null, estatus: "SIN_CALIFICAR" };
    const t = ord.trim().toUpperCase();
    // Casos comunes en Kárdex UNISON
    if (/(ACRE|ACRED|AC)/.test(t)) return { calificacion: null, estatus: "ACREDITADA" };
    if (/^NP$/.test(t))            return { calificacion: null, estatus: "NO_PRESENTÓ" };
    if (/^(NR|NA)$/.test(t))       return { calificacion: null, estatus: "NO_REGISTRADA" };
    if (/^(REPRO|REPR)$/.test(t))  return { calificacion: null, estatus: "REPROBADA" };
    if (/^EQ$/.test(t))            return { calificacion: null, estatus: "EQUIVALENCIA" };
    const n = parseInt(t.replace(/[^\d]/g, ""), 10);
    if (!Number.isNaN(n)) return { calificacion: n, estatus: "ORDINARIO" };
    return { calificacion: null, estatus: t as any };
};

const parseCreditos = (cr?: string | number | null) => {
  const s = String(cr ?? "");
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
};



// Split muy simple: "NOMBRES APELLIDO_P APELLIDO_M"
const splitNombre = (full: string) => {
    const p = NFC(full).split(" ");
    if (p.length < 2) return { nombre: full, ap: "", am: "" };
    const am = p.pop() as string;
    const ap = p.pop() as string;
    const nombre = p.join(" ");
    return { nombre, ap, am };
};

// --- ensures / upserts ---
async function ensurePlanEstudio(version: string, nombrePrograma: string) {
    const repo = AppDataSource.getRepository(PlanEstudio);
    let plan = await repo.findOne({ where: { version } });
    if (!plan) {
        // Crea solo si quieres auto-crear catálogo; si no, lanza error:
        plan = repo.create({
            nombre: NFC(nombrePrograma) || `Plan ${version}`,
            version,
            totalCreditos: 0,
            semestresSugeridos: 0
        });

        plan = await repo.save(plan);
    }
    return plan;
}

async function ensurePeriodo(cic: string) {
    const { anio, ciclo, etiqueta } = decodeCIC(cic);
    const repo = AppDataSource.getRepository(Periodo);
    let periodo = await repo.findOne({ where: { etiqueta } });
    if (!periodo) {
        periodo = repo.create({
            anio, ciclo, etiqueta,
            fecha_inicio: `${anio}-01-01`,
            fecha_fin: `${anio}-12-31`,
        });
        periodo = await repo.save(periodo);
    }
    return periodo;
}

async function ensureMateria(codigo: string, nombre: string, cr: string, planId: number) {
    const repo = AppDataSource.getRepository(Materia);
    let materia = await repo.findOne({ where: { codigo } }); // unique global en tu schema
    if (!materia) {
        materia = repo.create({
            codigo: codigo.trim(),
            nombre: NFC(nombre),
           creditos: (() => {
                const m = String(cr ?? "").match(/\d+/);
                return m ? parseInt(m[0], 10) : 0;
            })(),
            tipo: "OBLIGATORIA",
            plan_estudio_id: planId,
        });
        materia = await repo.save(materia);
    }
    return materia;
}

async function ensureAlumno(expediente: string, fullName: string, planId: number, estado: string) {
    const repo = AppDataSource.getRepository(Alumno);
    let alumno = await repo.findOne({ where: { expediente } });
    if (!alumno) {
        const { nombre, ap, am } = splitNombre(fullName);
        alumno = repo.create({
            matricula: expediente,
            expediente,
            nombre,
            apellidoPaterno: ap,
            apellidoMaterno: am,
            correo: `${expediente}@example.com`,
            estadoAcademico: estado === "A" ? "ACTIVO" : "INACTIVO",
            planEstudio: { id: planId } as any,  // relación con PlanEstudio
            totalCreditos: 0
        });
        alumno = await repo.save(alumno);
    }
    return alumno;
}

// --- API principal ---
export async function ingestarKardex(payload: KardexPayload) {
    if (!payload?.ok) throw new Error("Payload inválido");

    return AppDataSource.transaction(async (trx) => {
        // fija repos de la transacción
        const plan = await trx.getRepository(PlanEstudio)
            .findOne({ where: { version: payload.alumno.plan.trim() } })
            .then(async found => found ?? await ensurePlanEstudio(payload.alumno.plan.trim(), payload.alumno.programa));

        const alumno = await trx.getRepository(Alumno)
            .findOne({ where: { expediente: payload.alumno.expediente.trim() } })
            .then(async found => found ?? await ensureAlumno(
                payload.alumno.expediente.trim(),
                payload.alumno.alumno,
                plan.id,
                payload.alumno.estatus
            ));

        // Inserta renglones de Kardex
        for (const m of payload.materias) {
            const periodo = await trx.getRepository(Periodo)
                .findOne({ where: { etiqueta: decodeCIC(m.CIC).etiqueta } })
                .then(async found => found ?? await ensurePeriodo(m.CIC));

            const materia = await trx.getRepository(Materia)
                .findOne({ where: { codigo: m.CVE.trim() } })
                .then(async found => found ?? await ensureMateria(m.CVE, m.Materia, m.CR, plan.id));

            const { calificacion, estatus } = parseGrade(m.ORD);

            // Evita duplicados: (alumno, materia, periodo) único lógico
            const kardexRepo = trx.getRepository(Kardex);
            const exists = await kardexRepo.findOne({
                where: {
                    alumno_id: alumno.id,
                    materia_id: materia.id,
                    periodo_id: periodo.id
                }
            });
            if (exists) continue;

            const row = kardexRepo.create({
                alumno_id: alumno.id,
                materia_id: materia.id,
                periodo_id: periodo.id,
                calificacion,
                estatus,
                promedio_kardex: 0,
                promedio_sem_act: 0,
                filename: null
            });
            await kardexRepo.save(row);
        }

        return { ok: true, alumnoId: alumno.id, planId: plan.id, materiasCreadas: true };
    });
}
