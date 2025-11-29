// ingestaPlan.ts
import { AppDataSource } from "../config/data-source";
import { PlanEstudio } from "../entities/PlanEstudio";
import { Materia } from "../entities/Materia";
import { AuditoriaCargas } from "../entities/AuditoriaCargas";

type PlanMateria = {
  codigo: string;
  nombre: string;
  creditos: number;
  tipo?: "OBLIGATORIA" | "OPTATIVA" | string | null;
  semestre?: number | null;
};

type PlanPayload = {
  ok: boolean;
  plan: {
    nombre: string;
    version: string;
    total_creditos?: number;
    semestres_sugeridos?: number;
  };
  materias: PlanMateria[];
  warnings?: string[];
  // origen?: "OFICIAL" | "ALUMNO" | "DESCONOCIDO";
};

function canonTipo(raw?: string | null): "OBLIGATORIA" | "OPTATIVA" {
  const s = (raw || "").toUpperCase().normalize("NFC");
  if (/(OP|OPT|OPTATIVA|ELECTIVA|ELE|SEL)/.test(s)) return "OPTATIVA";
  return "OBLIGATORIA";
}

function normCodigo(c: string): string {
  const digits = (c || "").match(/\d+/)?.[0] ?? "";
  if (!digits) return "";
  return digits.length < 5 ? digits.padStart(5, "0") : digits;
}

function normNombre(n: string): string {
  return (n || "").replace(/\s{2,}/g, " ").trim();
}

function saneaCreditos(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > 30) return null;
  return Math.trunc(n);
}

export async function ingestaPlan(payload: PlanPayload, archivoId: number) {
  const ds = AppDataSource;
  const repoPlan = ds.getRepository(PlanEstudio);
  const repoMat  = ds.getRepository(Materia);
  const repoAud  = ds.getRepository(AuditoriaCargas);

  const warnings: string[] = [];

  // --- 1) Normaliza y deduplica payload por código ---
  type InMateriaTmp = {
    codigo: string;
    nombre: string;
    creditos: number | null; 
    tipo: "OBLIGATORIA" | "OPTATIVA";
    semestre: number | null;
  };

  const inMateriasTmp: InMateriaTmp[] = (payload.materias ?? []).map(m => ({
    codigo: normCodigo(m.codigo),
    nombre: normNombre(m.nombre),
    creditos: saneaCreditos(m.creditos),
    tipo: canonTipo(m.tipo as any),
    semestre: m.semestre ?? null,
  }));

  // filtra las que queden sin créditos válidos
  const inMateriasRaw: InMateriaTmp[] = inMateriasTmp.filter(m =>
    m.codigo && m.nombre && m.creditos !== null
  );

  // Dedupe por código (prefiere nombre más largo)
  const dedupe = new Map<string, InMateriaTmp>();
  for (const m of inMateriasRaw) {
    const prev = dedupe.get(m.codigo);
    if (!prev) {
      dedupe.set(m.codigo, m);
    } else if ((m.nombre || "").length > (prev.nombre || "").length) {
      dedupe.set(m.codigo, m);
    }
  }

  // Ahora sí: conviértelas a PlanMateria (creditos ya no es null)
  const materiasInput: PlanMateria[] = Array.from(dedupe.values()).map(m => ({
    codigo: normCodigo(m.codigo),
    nombre: m.nombre,
    creditos: m.creditos as number,
    tipo: m.tipo, // OBLIGATORIA/OPTATIVA
    semestre: m.semestre ?? null,
  }));

  // --- 2) Transacción para upsert atómico ---
  return await ds.transaction(async (trx) => {
    const planRepo = trx.getRepository(PlanEstudio);
    const matRepo  = trx.getRepository(Materia);
    const audRepo  = trx.getRepository(AuditoriaCargas);

    const planNombre = payload.plan?.nombre ?? "Ingeniería en Sistemas de Información";
const planVersion = payload.plan?.version ?? "N/A";
const totalCreditos = payload.plan?.total_creditos ?? 0;
const semestresSugeridos = payload.plan?.semestres_sugeridos ?? 0;

let plan: PlanEstudio; 

const existente = await planRepo.findOne({
  where: { nombre: planNombre, version: planVersion } as any,
});

if (existente) {
  existente.totalCreditos = totalCreditos || existente.totalCreditos || 0;
  existente.semestresSugeridos =
    semestresSugeridos ?? existente.semestresSugeridos ?? 0;
  plan = await planRepo.save(existente);
} else {
  const draft: Partial<PlanEstudio> = {
    nombre: planNombre,
    version: planVersion,
    totalCreditos,
    semestresSugeridos,
  };
  const nuevoPlan = planRepo.create(draft);   
  plan = await planRepo.save(nuevoPlan);      
}

    // === 2.2 Trae existentes por código (UNIQUE global) ===
    const cods = materiasInput.map(m => m.codigo);
    const existentes = cods.length
      ? await matRepo.createQueryBuilder("m")
          .where("m.codigo IN (:...cods)", { cods })
          .getMany()
      : [];
    const byCodigo = new Map(existentes.map(m => [m.codigo, m]));

    let added = 0, updated = 0, unchanged = 0;

    for (const m of materiasInput) {
      const prev = byCodigo.get(m.codigo);

      if (!prev) {
        const nueva = matRepo.create({
          codigo: m.codigo,
          nombre: m.nombre,
          creditos: m.creditos as number,
          tipo: (m.tipo ?? "OBLIGATORIA") as "OBLIGATORIA" | "OPTATIVA",
          plan_estudio_id: plan.id, // <-- plan ya es no-null
        });

        await matRepo.save(nueva);
        added++;
      } else {
        // Reasigna al plan actual (idempotente) y actualiza si cambió algo
        const before = JSON.stringify({
          nombre: prev.nombre,
          creditos: prev.creditos,
          tipo: prev.tipo,
          plan: prev.plan_estudio_id,
        });

        if (m.nombre && m.nombre !== prev.nombre) prev.nombre = m.nombre;
        if (m.creditos !== null && m.creditos !== prev.creditos) prev.creditos = m.creditos!;
        if (m.tipo && m.tipo !== prev.tipo) prev.tipo = m.tipo as "OBLIGATORIA" | "OPTATIVA";
        if (prev.plan_estudio_id !== plan.id) prev.plan_estudio_id = plan.id;

        const after = JSON.stringify({
          nombre: prev.nombre,
          creditos: prev.creditos,
          tipo: prev.tipo,
          plan: prev.plan_estudio_id,
        });

        if (before !== after) {
          await matRepo.save(prev);
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    const totalInput = materiasInput.length;
    const noChanges = (added === 0 && updated === 0);

    await audRepo.save(audRepo.create({
      archivo_id: archivoId,
      etapa: "INGESTA",
      estado: "OK",
      detalle: `Plan ${plan.nombre} v${plan.version} | input=${totalInput} | added=${added} | updated=${updated} | unchanged=${unchanged}${warnings.length ? ` | warnings=${warnings.length}` : ""}`,
    }));

    return {
      planId: plan.id,
      materiasInput: totalInput,
      added,
      updated,
      unchanged,
      warnings,
      action: noChanges ? "SKIPPED_NO_CHANGES" : "UPSERTED",
    };
  });
}
