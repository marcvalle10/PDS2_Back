#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parser unificado de Plan de Estudios (UNISON – ISI)
- Soporta:
  a) PDF descargado por el alumno (portal de alumnos)
  b) PDF oficial de docentes (“Listado de Materias Oficial ...”)
- Extrae materias (codigo, nombre, tipo, creditos) y datos básicos del plan.
- Detecta y opcionalmente captura las acentuaciones (hoja 3 del oficial).

Uso:
  python plan_estudio.py <ruta.pdf> [--debug] [--cont=N]

Salida (JSON):
{
  ok: bool,
  plan: { nombre, version, total_creditos, semestres_sugeridos },
  materias: [{ codigo, nombre, creditos, tipo, semestre? }],
  origen: "OFICIAL" | "ALUMNO" | "DESCONOCIDO",
  acentuaciones?: [
    { nombre: "DESARROLLO WEB", materias: [{codigo, nombre, creditos?}] }, ...
  ],
  warnings: [...],
  debug?: { extractor, frames_detected, row_text_examples: [...] }
}
"""
try:
    from pdfminer.high_level import extract_text as pdfminer_extract_text
except Exception:
    pdfminer_extract_text = None

import sys, json, re
from pathlib import Path
import pandas as pd

# ---- Dependencias opcionales (no truenan si no están) ----
try:
    import tabula
except Exception:
    tabula = None

try:
    import camelot
except Exception:
    camelot = None

try:
    from PyPDF2 import PdfReader
except Exception:
    PdfReader = None


# ------------------------ Utils ------------------------
def norm(s: str) -> str:
    return (s or "").replace("\xa0", " ").replace("\u200b", "").replace("\ufeff", "").strip()


def to_int_strict(s, default=None):
    """Convierte '3.0' -> 3, '03' -> 3. No concatena dígitos."""
    if s is None:
        return default
    m = re.search(r"\d+(?:\.\d+)?", str(s))
    if not m:
        return default
    try:
        return int(float(m.group(0)))
    except Exception:
        return default


def normalize_code(raw: str) -> str:
    """
    '4110.0' -> '04110', '121.0' -> '00121', '6881.0' -> '06881'
    Si ya trae 5+ dígitos, no padear.
    """
    if raw is None:
        return ""
    m = re.match(r"^\s*(\d+)(?:\.0)?\s*$", str(raw))
    if not m:
        # A veces viene pegado con texto; intenta extraer primer bloque dígitos
        mm = re.search(r"\b(\d{2,6})\b", str(raw))
        if not mm:
            return ""
        num = mm.group(1)
    else:
        num = m.group(1)
    if len(num) < 5:
        num = num.zfill(5)
    return num


def read_text_basic(path: Path) -> str:
    """Texto crudo: intenta primero pdfminer (mejor layout), luego PyPDF2."""
    # 1) pdfminer (si está disponible)
    if pdfminer_extract_text:
        try:
            t = pdfminer_extract_text(str(path)) or ""
            if t.strip():
                return t
        except Exception:
            pass
    # 2) PyPDF2 como respaldo
    text = ""
    if not PdfReader:
        return text
    try:
        reader = PdfReader(str(path))
        for p in reader.pages:
            t = p.extract_text() or ""
            text += t + "\n"
    except Exception:
        pass
    return text



def detect_origen(text: str) -> str:
    """
    Heurística:
    - OFICIAL: aparecen encabezados y pies de Dirección de Servicios Escolares,
               “Hoja : X de Y”, “MATERIAS QUE CONFORMAN LAS ACENTUACIONES”
               y columnas “Horas Teo./Horas Lab./Eje/Req.”
    - ALUMNO: suele traer “Créditos Aprobados: <N> de <M>” y sin ‘Hoja : X de Y’
    """
    t = text or ""
    t_up = t.upper()
    oficial_hits = 0
    if "DIRECCIÓN DE SERVICIOS ESCOLARES" in t_up:
        oficial_hits += 1
    if re.search(r"HOJA\s*:\s*\d+\s*DE\s*\d+", t_up):
        oficial_hits += 1
    if "MATERIAS QUE CONFORMAN LAS ACENTUACIONES" in t_up:
        oficial_hits += 1
    if re.search(r"\bHORAS\s+TEO\.\b", t_up) or re.search(r"\bHORAS\s+LAB\.\b", t_up):
        oficial_hits += 1
    if re.search(r"\bEJE\b", t_up) and re.search(r"\bREQ\.", t_up):
        oficial_hits += 1

    alumno_hits = 0
    if re.search(r"CR[EÉ]DITOS\s+APROBADOS:\s*\d+\s*DE\s*\d+", t_up):
        alumno_hits += 2  # señal fuerte
    if "PLAN" in t_up and re.search(r"INGENIER[ÍI]A EN SISTEMAS DE INFORMACI[ÓO]N", t_up):
        alumno_hits += 1

    if oficial_hits >= 2 and oficial_hits >= alumno_hits:
        return "OFICIAL"
    if alumno_hits >= 2 and alumno_hits > oficial_hits:
        return "ALUMNO"
    return "DESCONOCIDO"


# ----------------- Extracción de tablas -----------------
def try_tabula_frames(path: Path):
    """Intenta Tabula en lattice y stream; devuelve lista de DataFrames normalizados."""
    frames = []
    if not tabula:
        return frames

    def _fix_cols(df: pd.DataFrame) -> pd.DataFrame:
        df2 = df.copy()
        # Normaliza valores -> string y limpia nan
        for c in df2.columns:
            df2[c] = df2[c].astype(str).map(lambda x: norm(x) if x and x.lower() != "nan" else "")
        # Si headers "Unnamed" o vacíos: usar primera fila como encabezado real
        has_unnamed = any(str(c).lower().startswith("unnamed") for c in df2.columns)
        empty_headers = any(not str(c).strip() for c in df2.columns)
        if (has_unnamed or empty_headers) and len(df2) > 0:
            new_cols = [str(x).strip().upper() for x in list(df2.iloc[0])]
            if any(new_cols):
                df2 = df2.iloc[1:].reset_index(drop=True)
                df2.columns = new_cols
        else:
            df2.columns = [str(c).strip().upper() for c in df2.columns]
        return df2

    # 1) LATTICE
    try:
        dfs_lattice = tabula.read_pdf(
            str(path), pages="all", multiple_tables=True, lattice=True, stream=False, guess=False
        )
        for df in dfs_lattice or []:
            frames.append(_fix_cols(df))
    except Exception:
        pass

    # 2) STREAM
    try:
        dfs_stream = tabula.read_pdf(
            str(path), pages="all", multiple_tables=True, lattice=False, stream=True, guess=True
        )
        for df in dfs_stream or []:
            frames.append(_fix_cols(df))
    except Exception:
        pass

    return frames


def try_camelot_frames(path: Path):
    """Camelot como respaldo (si está disponible)."""
    frames = []
    if not camelot:
        return frames

    def _df_from_table(t):
        df = t.df.copy()
        # primera fila como header
        df.columns = [str(c).strip() for c in df.iloc[0]]
        df = df.iloc[1:].copy().reset_index(drop=True)
        df.columns = [str(c).strip().upper() for c in df.columns]
        for c in df.columns:
            df[c] = df[c].astype(str).map(lambda x: norm(x) if x and x.lower() != "nan" else "")
        return df

    try:
        tables = camelot.read_pdf(str(path), pages="all", flavor="lattice")
        frames += [_df_from_table(t) for t in tables]
    except Exception:
        pass
    try:
        tables = camelot.read_pdf(str(path), pages="all", flavor="stream")
        frames += [_df_from_table(t) for t in tables]
    except Exception:
        pass
    return frames


# -------------- Parsers (Alumno vs Oficial) --------------
COD_RE = re.compile(r"\b\d{2,6}\b")
TIPO_RE = re.compile(r"^(OBL|OPT|ELE|SEL|\*?OBL|\*?OPT)$", re.I)

MAX_CONT_LINES = int((next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cont=")), "2")))


def is_small_credit(s) -> bool:
    v = to_int_strict(s, None)
    return v is not None and 1 <= v <= 30


def parse_frames_portal_alumno(frames, want_debug=False):
    """
    Reusa la máquina de estados previa (pegado de líneas) porque los PDFs
    del portal de alumnos suelen venir con filas fragmentadas.
    """
    # 1) Aplanar en líneas limpias
    lines = []
    debug_rows = []
    for df in frames:
        if df.empty:
            continue
        df = df.loc[~(df == "").all(axis=1)]
        if df.empty:
            continue
        for _, row in df.iterrows():
            toks = [norm(str(row.iloc[j])) for j in range(df.shape[1])]
            toks = [t for t in toks if t and not re.fullmatch(r"Unnamed:\s*\d+", t, re.I)]
            line = re.sub(r"\s{2,}", " ", " ".join(toks)).strip()
            if line:
                lines.append(line)
                if want_debug and len(debug_rows) < 12:
                    debug_rows.append(line)

    materias = []
    pre_name_buffer: list[str] = []
    i = 0

    def has_letters(s: str) -> bool:
        return re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]", s) is not None

    while i < len(lines):
        line = lines[i]

        m_code = re.search(r"\b\d+(?:\.0)?\b", line)
        code_token = None
        if m_code:
            digits = re.sub(r"\D", "", m_code.group(0))
            if 2 <= len(digits) <= 6:
                code_token = m_code.group(0)

        m_type = re.search(r"\b(OBL|OPT|ELE|SEL)\b", line, re.I)
        type_token = m_type.group(1).upper() if m_type else None

        # Solo texto → acumula como pre-nombre
        if not code_token and not type_token and has_letters(line):
            pre_name_buffer.append(line)
            i += 1
            continue

        if code_token:
            codigo = normalize_code(code_token)

            # ----- nombre inline (entre código y tipo; o después del código si no hay tipo)
            end_code_pos = m_code.end()
            inline_segment = line[end_code_pos:m_type.start()] if m_type else line[end_code_pos:]
            inline_name = norm(inline_segment)
            use_inline = has_letters(inline_name) and len(inline_name) >= 4

            # ---- tipo
            tipo = type_token or None

            # ---- créditos
            creditos = None
            if tipo:
                m_num_after = re.search(r"\d+(?:\.\d+)?", line[m_type.end():])
                if m_num_after:
                    creditos = to_int_strict(m_num_after.group(0), None)
            if creditos is None:
                m_any = re.search(r"\d+(?:\.\d+)?", line)
                if m_any:
                    cand = to_int_strict(m_any.group(0), None)
                    if is_small_credit(cand):
                        creditos = cand

            name_parts: list[str] = []

            if use_inline:
                # ️❗ Si hay inline, NO uses prebuffer NI continuación posterior
                name_parts.append(inline_name)
                pre_used = False
                take_continuation = 0
            else:
                # usa prebuffer (si existe) y permite hasta N líneas de continuación
                if pre_name_buffer:
                    name_parts.extend(pre_name_buffer)
                pre_used = True
                take_continuation = MAX_CONT_LINES

            # continuaciones (solo si NO hubo inline)
            while take_continuation > 0 and (i + 1) < len(lines):
                nxt = lines[i + 1]
                nxt_has_code = re.search(r"\b\d+(?:\.0)?\b", nxt) is not None
                nxt_has_type = re.search(r"\b(OBL|OPT|ELE|SEL)\b", nxt, re.I) is not None
                if (not nxt_has_code) and (not nxt_has_type) and has_letters(nxt):
                    name_parts.append(nxt)
                    i += 1  # consume la línea de continuación
                    take_continuation -= 1
                else:
                    break

            nombre = norm(" ".join(name_parts))

            if codigo and nombre and creditos is not None and 1 <= creditos <= 30:
                materias.append({
                    "codigo": codigo,
                    "nombre": nombre,
                    "creditos": int(creditos),
                    "tipo": "OPT" if (tipo in ("OPT", "ELE", "SEL")) else "OBL",
                    "semestre": None
                })
                if pre_used:
                    pre_name_buffer = []
            i += 1
            continue

        # línea con tipo pero sin código → ignora; limpia prebuffer si no hay letras
        if not has_letters(line):
            pre_name_buffer = []
        i += 1

    # dedup por código
    uniq = {}
    for m in materias:
        uniq[m["codigo"]] = m
    materias = list(uniq.values())

    return materias, debug_rows


# ---- Parser del PDF OFICIAL (basado en mapeo de columnas) ----
OFI_COL_MAP = {
    # posibles encabezados: se mapean a campos “internos”
    "CLAVE": "codigo",
    "CVE": "codigo",
    "MATERIA": "nombre",
    "TIPO": "tipo",
    "CRÉDITOS": "creditos",
    "CREDITOS": "creditos",
    # ignorados pero comunes:
    "HORAS TEO.": None,
    "HORAS LAB.": None,
    "EJE": None,
    "CRÉDITOS REQ.": None,
    "CREDITOS REQ.": None,
    "REQ. MATERIAS REQUISTO": None,
    "REQ. MATERIAS REQUISITO": None,
    "REQUISITOS": None,
    "REQ.": None,
}

ACENT_TITLE_RE = re.compile(r"^\s*MATERIAS QUE CONFORMAN LAS ACENTUACIONES\s*$", re.I)


def normalize_tipo(val: str) -> str:
    v = (val or "").upper().replace("*", "")
    if v in ("OPT", "ELE", "SEL"):
        return "OPT"
    return "OBL" if v == "OBL" else (v or "OBL")


def parse_frames_oficial(frames, text_full: str, want_debug=False):
    """
    Intenta leer tablas por columnas. Algunas páginas se parten en 2 tablas;
    las fusionamos lógicamente. Filtramos filas de encabezados y pies.
    """
    materias = []
    debug_rows = []
    acentuaciones = []

    # 1) Detectar el bloque de acentuaciones a partir del texto, para ubicar sus códigos
    #    (algunas veces las tablas salen sin encabezado claro)
    #    Si no se encuentra, seguimos normal.
    acent_mode = False
    acent_actual = None
    if "MATERIAS QUE CONFORMAN LAS ACENTUACIONES" in (text_full or "").upper():
        acent_mode = True

    # 2) Procesar frames
    for df in frames:
        if df.empty:
            continue

        # Heurística: si el frame parece una tabla de acentuaciones (dos columnas: clave/materia/creditos),
        # la marcamos aparte. Buscamos títulos de bloque como "DESARROLLO WEB", "COMPUTACIÓN MÓVIL", etc.
        # Estructura típica en hoja 3: una columna “Clave Materia Créditos” y líneas por acentuación.

        # Señales de bloque de acentuaciones:
        header_str = " ".join([str(c) for c in df.columns]).upper()
        looks_acents = ("CLAVE" in header_str and "MATERIA" in header_str and "CRÉDIT" in header_str) \
                       or ("CLAVE" in header_str and "MATERIA" in header_str and "CREDIT" in header_str)

        # También si el DataFrame es de 2-3 columnas y muchas filas de “codigo nombre numero”
        if acent_mode and (looks_acents or (len(df.columns) in (2, 3))):
            # Intenta extraer pares (codigo, nombre, creditos?)
            # Primero detecta si hay títulos de acentuación (líneas en MAYÚSCULAS sin código)
            # Normaliza columnas a texto
            d = df.copy()
            d.columns = [norm(str(c).upper()) for c in d.columns]
            for c in d.columns:
                d[c] = d[c].astype(str).map(lambda x: norm(x))

            # Construcción lineal por filas
            for _, row in d.iterrows():
                row_vals = [norm(str(v)) for v in row.tolist()]
                line = " ".join([v for v in row_vals if v]).strip()
                if not line:
                    continue

                # título de acentuación (sin códigos)
                if not re.search(r"\b\d{2,6}\b", line) and line.isupper() and len(line) <= 40:
                    # Cierra bloque anterior
                    if acent_actual and acent_actual["materias"]:
                        acentuaciones.append(acent_actual)
                    # Abre nuevo bloque
                    acent_actual = {"nombre": line, "materias": []}
                    continue

                # buscar código y nombre (+ crédito opcional al final)
                mc = re.search(r"\b(\d{2,6})\b", line)
                if mc:
                    codigo = normalize_code(mc.group(1))
                    # nombre: quita el código inicial y posible entero al final
                    tail_credit = None
                    tmp = re.sub(r"^\s*\b\d{2,6}\b\s*", "", line)
                    m_last_int = re.search(r"(\d+)\s*$", tmp)
                    if m_last_int:
                        tail_credit = to_int_strict(m_last_int.group(1), None)
                        tmp = tmp[:m_last_int.start()].strip()
                    nombre = norm(tmp)
                    if acent_actual is None:
                        acent_actual = {"nombre": "ACENTUACIÓN", "materias": []}
                    acent_actual["materias"].append({
                        "codigo": codigo,
                        "nombre": nombre,
                        **({"creditos": int(tail_credit)} if tail_credit else {})
                    })
            continue  # no mezclar con materias “normales” de la malla

        # Si no es acentuación, parseo de malla normal
        # 2.1 Normaliza columnas y crea un mapeo flexible
        df2 = df.copy()
        df2.columns = [norm(str(c).upper()) for c in df2.columns]
        for c in df2.columns:
            df2[c] = df2[c].astype(str).map(lambda x: norm(x) if x and x.lower() != "nan" else "")

        # Intentar encontrar columnas clave por aproximación
        col_codigo = next((c for c in df2.columns if re.search(r"\bCLAVE\b|\bCVE\b", c)), None)
        col_nombre = next((c for c in df2.columns if "MATERIA" in c), None)
        col_tipo   = next((c for c in df2.columns if "TIPO" in c), None)
        col_cred   = next((c for c in df2.columns if "CRÉDIT" in c or "CREDIT" in c), None)

        # A veces Tabula separa “Clave Materia Tipo Créditos …” en una sola cadena por fila.
        if not any([col_codigo, col_nombre, col_tipo, col_cred]):
            # Intento por filas “pegadas”
            for _, row in df2.iterrows():
                row_vals = [v for v in row.tolist() if v]
                line = " ".join(row_vals)
                if want_debug and len(debug_rows) < 12:
                    debug_rows.append(line)
                # Omite pies/encabezados ruidosos
                up = line.upper()
                if not line or "UNIVERSIDAD DE SONORA" in up or "HOJA : " in up:
                    continue
                # Patrón: "<codigo> <nombre...> <tipo> <creditos>"
                m_code = re.search(r"\b(\d{2,6})\b", line)
                m_tipo = re.search(r"\b(OBL|OPT|ELE|SEL)\b", line, re.I)
                m_cred = re.search(r"(\d{1,2})(?!.*\d)", line)  # último entero chico
                if not m_code or not m_tipo or not m_cred:
                    continue
                codigo = normalize_code(m_code.group(1))
                tipo = normalize_tipo(m_tipo.group(1))
                creditos = to_int_strict(m_cred.group(1), None)
                # nombre: entre código y tipo
                nombre_seg = line[m_code.end():m_tipo.start()]
                nombre = norm(nombre_seg)
                if codigo and nombre and is_small_credit(creditos):
                    materias.append({
                        "codigo": codigo,
                        "nombre": nombre,
                        "creditos": int(creditos),
                        "tipo": "OPT" if tipo == "OPT" else "OBL",
                        "semestre": None
                    })
            continue

        # 2.2 Parseo columna a columna
        for _, row in df2.iterrows():
            raw_codigo = row[col_codigo] if col_codigo else ""
            raw_nombre = row[col_nombre] if col_nombre else ""
            raw_tipo   = row[col_tipo] if col_tipo else ""
            raw_cred   = row[col_cred] if col_cred else ""

            # Filtrado de encabezados/ruido
            line_join = " ".join([raw_codigo, raw_nombre, raw_tipo, raw_cred]).upper()
            if not raw_codigo and not re.search(r"\b\d{2,6}\b", line_join):
                continue
            if "CLAVE" in line_join and "MATERIA" in line_join:
                continue
            if "UNIVERSIDAD DE SONORA" in line_join or "HOJA : " in line_join:
                continue
            if not raw_nombre:
                # si nombre vacío y parece fila de continuación, se ignora (oficial rara vez corta el nombre)
                continue

            codigo = normalize_code(raw_codigo)
            if not codigo:
                # en algunos casos el código viene incrustado al inicio del nombre
                mc = re.match(r"^\s*(\d{2,6})\s+(.*)$", raw_nombre)
                if mc:
                    codigo = normalize_code(mc.group(1))
                    raw_nombre = mc.group(2)

            nombre = norm(raw_nombre)
            tipo = normalize_tipo(raw_tipo)
            creditos = to_int_strict(raw_cred, None)

            if codigo and nombre and is_small_credit(creditos):
                materias.append({
                    "codigo": codigo,
                    "nombre": nombre,
                    "creditos": int(creditos),
                    "tipo": "OPT" if tipo == "OPT" else "OBL",
                    "semestre": None
                })

    # Cierra último bloque de acentuación abierto
    if acent_mode and 'acent_actual' in locals() and acent_actual and acent_actual["materias"]:
        acentuaciones.append(acent_actual)

    # Deduplicar por código (con preferencia por OBL si hay conflicto)
    by_code = {}
    for m in materias:
        if m["codigo"] in by_code:
            prev = by_code[m["codigo"]]
            # si uno es OBL y otro OPT, conserva OBL
            if prev["tipo"] == "OPT" and m["tipo"] == "OBL":
                by_code[m["codigo"]] = m
        else:
            by_code[m["codigo"]] = m
    materias = list(by_code.values())

    # Debug sample
    if want_debug:
        # agrega algunas filas ejemplo si no se recolectaron arriba
        for df in frames:
            if len(debug_rows) >= 12:
                break
            for _, row in df.iterrows():
                if len(debug_rows) >= 12:
                    break
                debug_rows.append(" | ".join([norm(str(v)) for v in row.tolist()]))

    return materias, acentuaciones, debug_rows


# -------------- Limpieza / Info del plan --------------
def parse_plan_info(text: str):
    """
    Extrae versión y total de créditos.
    - La versión se toma como un entero de 4 dígitos cercano a la etiqueta 'PLAN'.
    - Evita confundirla con códigos de materias (usualmente 5 dígitos).
    """
    t = text or ""
    version = None

    # 0) Normalizaciones útiles
    t_flat = re.sub(r"\s+", " ", t)  # una sola línea para patrones "aplanados"
    # ---------------------------------------------------------------
    # 1) Búsqueda directa: "PLAN: 2182" (mismo renglón, con o sin ':')
    m = re.search(r"\bPLAN\b\s*[:\-]?\s*(\d{4})(?!\d)", t, re.I)
    if m:
        version = m.group(1)

    # 2) Si no, buscar el 4-dígitos más cercano a cada 'PLAN' (permite saltos de línea)
    if not version:
        plan_spans = [m.span() for m in re.finditer(r"\bPLAN\b", t, re.I)]
        # candidatos: (distancia, numero)
        cand = []
        for a, b in plan_spans:
            # ventana pequeña hacia adelante (por experiencia 0..60 suele bastar)
            window = t[b:b+120]
            mm = re.finditer(r"\b(\d{4})(?!\d)", window)
            # el primero (menor índice) es el más cercano a 'PLAN'
            for mnum in mm:
                dist = mnum.start()
                cand.append((dist, mnum.group(1)))
                break
        if cand:
            cand.sort(key=lambda x: x[0])
            version = cand[0][1]

    # 3) Respaldo por PROGRAMA (encabezado del oficial), también a 4 dígitos
    if not version:
        m = re.search(
            r"PROGRAMA:\s*INGENIER[ÍI]A\s+EN\s+SISTEMAS\s+DE\s+INFORMACI[ÓO]N\s+(\d{4})(?!\d)",
            t_flat, re.I
        )
        if m:
            version = m.group(1)

    # 4) Respaldo por “nombre del programa ... <número>” (aparece a veces)
    if not version:
        m = re.search(
            r"INGENIER[ÍI]A\s+EN\s+SISTEMAS\s+DE\s+INFORMACI[ÓO]N(?:\s*\(.*?\))?\s*(\d{4})(?!\d)",
            t, re.I
        )
        if m:
            version = m.group(1)

    # ---- Total de créditos (tus reglas, sin cambios de lógica)
    total = None
    mtot1 = re.search(r"CR[EÉ]DITOS\s+APROBADOS:\s*\d+\s*DE\s*(\d{2,3})", t, re.I)
    if mtot1:
        total = to_int_strict(mtot1.group(1), None)
    if total is None:
        mtot2 = re.search(r"M[IÍ]NIMO\s+DE\s+(\d{2,3})\s+CR[EÉ]DITOS", t, re.I)
        if mtot2:
            total = to_int_strict(mtot2.group(1), None)

    return (version or "N/A"), (total or 0)


def sanitize_materias(mats):
    out = []
    for m in mats:
        n = m["nombre"]
        # Normaliza espacios
        n = re.sub(r"\s{2,}", " ", n)
        # Une guiones cortados: "CENEVAL- EGEL" -> "CENEVAL-EGEL"
        n = re.sub(r"(\w)-\s+(\w)", r"\1-\2", n)
        # Quita repeticiones exactas de frases
        n = re.sub(r"(DESEMPEÑO EN EVALUACIÓN EXTERNA.*?\))\s+\1", r"\1", n, flags=re.I)
        # Podar colas residuales tipo "Clave Materia Creditos"
        n = re.sub(r"\b(Clave\s+Materia\s+Creditos)\b.*$", "", n, flags=re.I).strip(" -")
        # Limpieza artículos iniciales sueltos
        n = re.sub(r"^(DE|LA|EL)\s+(?=[A-ZÁÉÍÓÚÑ])", "", n, flags=re.I)
        m["nombre"] = n.strip()
        out.append(m)
    return out


# ----------------------------- Main -----------------------------
def main():
    debug = any(a == "--debug" for a in sys.argv[1:])
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Uso: plan_estudio.py <archivo.pdf> [--debug]"}))
        return

    pdf_path = None
    for a in sys.argv[1:]:
        if not a.startswith("--"):
            pdf_path = a
            break
    if not pdf_path:
        print(json.dumps({"ok": False, "error": "Falta ruta del PDF"}))
        return

    path = Path(pdf_path)
    if not path.exists():
        print(json.dumps({"ok": False, "error": f"No existe {path}"}))
        return

    # Texto base (para origen, versión y total créditos)
    text = read_text_basic(path)
    origen = detect_origen(text)

    # Frames por Tabula; si no, Camelot
    frames = try_tabula_frames(path)
    extractor = "tabula"
    if not frames:
        frames = try_camelot_frames(path)
        extractor = "camelot"

    materias, debug_rows = [], []
    acentuaciones = []

    if origen == "OFICIAL":
        materias, acentuaciones, debug_rows = parse_frames_oficial(frames, text_full=text, want_debug=debug)
    else:
        # Portal alumno o desconocido → usa el parser de “pegado de líneas”
        materias, debug_rows = parse_frames_portal_alumno(frames, want_debug=debug)

    materias = sanitize_materias(materias)
    version, total = parse_plan_info(text)

    result = {
        "ok": bool(materias),
        "plan": {
            "nombre": "Ingeniería en Sistemas de Información",
            "version": version,
            "total_creditos": total,
            "semestres_sugeridos": 0
        },
        "materias": materias,
        "origen": origen,
        **({"acentuaciones": acentuaciones} if acentuaciones else {}),
        "warnings": [] if materias else [f"No se detectaron materias con {extractor}."],
        "debug": {
            "extractor": extractor,
            "frames_detected": len(frames),
            "row_text_examples": debug_rows
        } if debug else None
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
