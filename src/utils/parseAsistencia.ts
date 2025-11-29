import * as XLSX from 'xlsx';

export type MetaAsistencia = {
  titulo: string | null;        // "Lista de Asistencia del mes de SEPTIEMBRE"
  materiaCodigo: string | null; // 4134
  materiaNombre: string | null; // PRÁCTICA DE DESARROLLO...
  grupoTexto: string | null;    // "1 - TEORIA"
  lugar: string | null;         // "5G-A201"
  mes: string | null;           // "SEPTIEMBRE"
  anio: number | null;          // si luego lo quieres llenar
  horarioTexto: string | null;  // "Horario: LUN 11:00-12:00, ..."
};

export type FilaAsistencia = {
  expediente: string;
  nombre: string;
  total: number | null;   // valor de ∑F (si viene)
  rowIndex: number;       // número de fila (1-based, para logs)
};

export type ParseAsistenciaResult = {
  meta: MetaAsistencia;
  rows: FilaAsistencia[];
};

/**
 * Lee una lista de asistencia en el formato "AlumnosMateria.xlsx"
 * y devuelve meta + filas de alumnos.
 */
export function leerListaAsistencia(filePath: string): ParseAsistenciaResult {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const raw: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    blankrows: false,
  });

  if (!raw || raw.length === 0) {
    return {
      meta: {
        titulo: null,
        materiaCodigo: null,
        materiaNombre: null,
        grupoTexto: null,
        lugar: null,
        mes: null,
        anio: null,
        horarioTexto: null,
      },
      rows: [],
    };
  }

  // ---------- 1) META: título, mes, materia, grupo, lugar, horario ----------

  let titulo: string | null = null;
  let mes: string | null = null;
  let materiaCodigo: string | null = null;
  let materiaNombre: string | null = null;
  let grupoTexto: string | null = null;
  let lugar: string | null = null;
  let horarioTexto: string | null = null;

  // Buscamos título / mes en las primeras filas
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const cell0 = (raw[i] && raw[i][0]) ? String(raw[i][0]) : '';
    const upper = cell0.toUpperCase();

    if (!titulo && upper.includes('LISTA DE ASISTENCIA')) {
      titulo = cell0;

      const m = upper.match(/MES DE\s+([A-ZÁÉÍÓÚÑ]+)/);
      if (m) {
        mes = m[1].trim();
      }
    }

    if (!materiaCodigo && upper.startsWith('MATERIA:')) {
      // Ej:
      // "Materia: 4134 - PRÁCTICA DE DESARROLLO... Grupo: 1 - TEORIA Lugar: 5G-A201"
      const materiaRegex =
        /Materia:\s*([0-9]+)\s*-\s*(.+?)\s+Grupo:\s*(.+?)\s+Lugar:\s*(.+)$/i;
      const match = cell0.match(materiaRegex);
      if (match) {
        materiaCodigo = match[1].trim();
        materiaNombre = match[2].trim();
        grupoTexto = match[3].trim();
        lugar = match[4].trim();
      }
    }

    if (!horarioTexto && upper.startsWith('HORARIO:')) {
      horarioTexto = cell0.trim();
    }
  }

  const meta: MetaAsistencia = {
    titulo,
    materiaCodigo,
    materiaNombre,
    grupoTexto,
    lugar,
    mes,
    anio: null, // si luego quieres inferirlo de fechas, lo llenas
    horarioTexto,
  };

  // ---------- 2) Buscar fila de encabezado (Expediente / Nombre) ----------

  let headerRowIndex = -1;

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || [];
    const first = row[0] != null ? String(row[0]).trim().toUpperCase() : '';
    const second = row[1] != null ? String(row[1]).trim().toUpperCase() : '';

    if (first === 'EXPEDIENTE' && second === 'NOMBRE') {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Formato inesperado
    return {
      meta,
      rows: [],
    };
  }

  const headerRow = raw[headerRowIndex];

  // ---------- 3) Columna de ∑F ----------

  let sumColIndex = -1;

  for (let j = 0; j < headerRow.length; j++) {
    const cell = headerRow[j];
    if (cell == null) continue;
    const txt = String(cell).trim().toUpperCase();
    if (txt.startsWith('∑') || txt === 'SUMA' || txt === 'TOTAL') {
      sumColIndex = j;
      break;
    }
  }

  if (sumColIndex === -1) {
    // si no la encontramos, usamos la última columna no vacía
    sumColIndex = headerRow.length - 1;
  }

  // ---------- 4) Filas de datos (alumnos) ----------

  // Normalmente:
  // headerRowIndex      → "Expediente | Nombre | L | M | ..."
  // headerRowIndex + 1  → "         -|      - | 1 | 2 | ..."
  // headerRowIndex + 2  → primera fila de alumno
  const dataStart = headerRowIndex + 2;
  const rows: FilaAsistencia[] = [];

  for (let i = dataStart; i < raw.length; i++) {
    const row = raw[i] || [];
    const expediente = row[0] != null ? String(row[0]).trim() : '';
    const nombre = row[1] != null ? String(row[1]).trim() : '';

    // Fila vacía
    if (!expediente && !nombre) {
      continue;
    }

    let total: number | null = null;
    if (sumColIndex >= 0 && sumColIndex < row.length) {
      const totalRaw = row[sumColIndex];
      if (
        totalRaw !== undefined &&
        totalRaw !== null &&
        String(totalRaw).trim() !== ''
      ) {
        const n = Number(totalRaw);
        total = Number.isNaN(n) ? null : n;
      }
    }

    rows.push({
      expediente,
      nombre,
      total,
      rowIndex: i + 1, // 1-based como en Excel
    });
  }

  return { meta, rows };
}
