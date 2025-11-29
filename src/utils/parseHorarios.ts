import * as XLSX from 'xlsx';

export type Dia = 'LUN'|'MAR'|'MIE'|'JUE'|'VIE'|'SAB';
export type Slot = { dia: Dia; horaInicio: string; horaFin: string; };

export type NormalizedHorario = {
  fuente: 'ISI' | 'PRELISTAS';
  periodo?: string | null;     // "2025-1" si viene en Prelistas
  codigoMateria?: string | null;
  claveMateria?: string | null;
  nombreMateria: string;
  grupo?: string | null;       // sección/grupo
  nrc?: string | null;
  profesor?: string | null;
  noEmpleado?: string | null;  // CLAVE en Prelistas (num_empleado)
  aula?: string | null;
  inscritos?: number | null;
  slots: Slot[];
};

function toHHMM(rango?: string | null) {
  if (!rango) return null;
  const m = String(rango).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const pad = (s: string) => s.padStart(2, '0');
  return `${pad(m[1])}:${m[2]}-${pad(m[3])}:${m[4]}`;
}
function splitRango(rango: string) {
  const t = toHHMM(rango); if (!t) return null;
  const [ini, fin] = t.split('-'); return { ini, fin };
}

export async function leerHorariosISI(path: string) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });

  const headerIdx = raw.findIndex(r => Array.isArray(r) && r.some(v => String(v || '').toUpperCase().includes('NOMBRE DE LA MATERIA')));
  if (headerIdx < 0) return { rows: [] as NormalizedHorario[], headers: [] as string[] };

  const header = (raw[headerIdx] || []).map(v => String(v || '').trim());
  const idx = {
    materia: header.findIndex(h => h.toUpperCase().includes('NOMBRE DE LA MATERIA')),
    profesor: header.findIndex(h => h.toUpperCase().includes('NOMBRE DEL MAESTRO')),
    aula: header.findIndex(h => h.toUpperCase() === 'AULA'),
    LUN: header.findIndex(h => h.toUpperCase() === 'LUN'),
    MAR: header.findIndex(h => h.toUpperCase() === 'MAR'),
    MIE: header.findIndex(h => h.toUpperCase() === 'MIE'),
    JUE: header.findIndex(h => h.toUpperCase() === 'JUE'),
    VIE: header.findIndex(h => h.toUpperCase() === 'VIE'),
  };

  const rows: NormalizedHorario[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as any[];
    if (!row) continue;

    const nombreMateria = String(row[idx.materia] ?? '').trim();
    if (!nombreMateria) continue;

    const profesor = String(row[idx.profesor] ?? '').trim() || null;
    const aula = String(row[idx.aula] ?? '').trim() || null;

    const dias: Dia[] = ['LUN','MAR','MIE','JUE','VIE'];
    const slots: Slot[] = [];
    for (const d of dias) {
      const col = (idx as any)[d];
      if (col >= 0) {
        const v = String(row[col] ?? '').trim();
        if (v) {
          const r = splitRango(v);
          if (r) slots.push({ dia: d, horaInicio: r.ini, horaFin: r.fin });
        }
      }
    }

    rows.push({
      fuente: 'ISI',
      periodo: null, codigoMateria: null, claveMateria: null,
      nombreMateria, grupo: null, nrc: null,
      profesor, noEmpleado: null, aula, inscritos: null, slots,
    });
  }
  return { rows, headers: header };
}

export async function leerPrelistas(path: string) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });

  let ciclo: string | null = null;
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const line = (raw[r] || []).map(v => String(v || '')).join(' ');
    const m = line.match(/CICLO:\s*([0-9]{4}-[12])/i);
    if (m) { ciclo = m[1]; break; }
  }

  const headerIdx = raw.findIndex(r => {
    const line = (r || []).map(x => String(x || '').toUpperCase());
    return line.includes('MAT') && line.includes('GRUPO');
  });
  if (headerIdx < 0) return { rows: [] as NormalizedHorario[], headers: [] as string[] };

  const header = (raw[headerIdx] || []).map(v => String(v || '').trim().toUpperCase());
  const col = (name: string) => header.findIndex(h => h === name.toUpperCase());

  const idx = {
    MAT: col('MAT'),
    GRUPO: col('GRUPO'),
    NRC: col('NRC'),
    CODIGO: (col('CÓDIGO') >= 0 ? col('CÓDIGO') : col('CODIGO')),
    MATERIA: col('MATERIA'),
    SECCION: (col('SECCIÓN') >= 0 ? col('SECCIÓN') : col('SECCION')),
    INSCRITOS: col('INSCRITOS'),
    PROFESOR: col('PROFESOR'),
    CLAVE: col('CLAVE'),
    AULA: col('AULA'),
    LUN: col('LUN'), MAR: col('MAR'), MIE: col('MIE'), JUE: col('JUE'), VIE: col('VIE'), SAB: col('SAB'),
  };

  const rows: NormalizedHorario[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as any[];
    if (!row) continue;

    const mat = String(row[idx.MAT] ?? '').trim();
    const materia = String(row[idx.MATERIA] ?? '').trim();
    if (!mat && !materia) continue;

    const slots: Slot[] = [];
    (['LUN','MAR','MIE','JUE','VIE','SAB'] as Dia[]).forEach(d => {
      const ci = (idx as any)[d];
      const v = ci >= 0 ? String(row[ci] ?? '').trim() : '';
      if (v) {
        const r = splitRango(v);
        if (r) slots.push({ dia: d, horaInicio: r.ini, horaFin: r.fin });
      }
    });

    rows.push({
      fuente: 'PRELISTAS',
      periodo: ciclo,
      codigoMateria: idx.CODIGO >= 0 ? (String(row[idx.CODIGO] ?? '').trim() || null) : null,
      claveMateria: mat || null,
      nombreMateria: materia || '(sin nombre)',
      grupo: idx.SECCION >= 0 ? (String(row[idx.SECCION] ?? '').trim() || null) : (idx.GRUPO >= 0 ? String(row[idx.GRUPO] ?? '').trim() : null),
      nrc: idx.NRC >= 0 ? (String(row[idx.NRC] ?? '').trim() || null) : null,
      profesor: idx.PROFESOR >= 0 ? (String(row[idx.PROFESOR] ?? '').trim() || null) : null,
      noEmpleado: idx.CLAVE >= 0 ? (String(row[idx.CLAVE] ?? '').trim() || null) : null,
      aula: idx.AULA >= 0 ? (String(row[idx.AULA] ?? '').trim() || null) : null,
      inscritos: idx.INSCRITOS >= 0 ? (Number(row[idx.INSCRITOS]) || 0) : null,
      slots,
    });
  }
  return { rows, headers: header };
}
