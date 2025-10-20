#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys, json, re
from pathlib import Path

# ---------- Dependencias de extracción ----------
try:
    import pdfplumber  # Para tablas (materias) y texto
except Exception as e:
    raise SystemExit("Instala pdfplumber: pip install pdfplumber") from e

# (Opcional) afinar texto con pdfminer si lo deseas
try:
    from pdfminer.high_level import extract_text as pdfminer_extract_text
except Exception:
    pdfminer_extract_text = None


# ============================================================
# Utilidades
# ============================================================
def read_text(path: Path) -> str:
    """
    Extrae texto del PDF. Primero pdfplumber (más estable para bloques),
    si se requiere mayor continuidad puede intentarse pdfminer.
    """
    text = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            # pdfplumber: texto por página
            page_text = page.extract_text() or ""
            text.append(page_text)
    out = "\n".join(text)

    # Si necesitas más continuidad (algunos PDF cortan líneas),
    # descomenta para mezclar con pdfminer cuando esté disponible:
    # if pdfminer_extract_text:
    #     mix = pdfminer_extract_text(str(path)) or ""
    #     # Priorizamos plumber, pero podrías fusionar/normalizar si lo deseas
    #     if len(mix) > len(out) * 1.2:
    #         out = mix

    return out


def normalize_spaces(s: str) -> str:
    return re.sub(r"[ \t]+", " ", s).strip()


# ============================================================
# 1) CABECERA
# ============================================================
def extract_header(raw_text: str) -> dict:
    """
    Cabecera típica:
      PROGRAMA: ...
      PLAN: 2182
      UNIDAD: HERMOSILLO
      EXPEDIENTE: 222202156  NOMBRE COMPLETO
      ESTATUS: A .. Alumno activo....
      Fecha: 21/09/2025
    """
    # Quitamos ruidos comunes
    cleaned = re.sub(r"Universidad de Sonora.*?KÁRDEX ELECTRÓNICO", "", raw_text, flags=re.S)
    cleaned = re.sub(r"Pagina \d+ de \d+", "", cleaned)
    cleaned = cleaned.replace(".. Alumno activo....", "")  # deja sólo "ESTATUS: A" (o similar)

    def grab(pat, s=cleaned, flags=re.M):
        m = re.search(pat, s, flags)
        return normalize_spaces(m.group(1)) if m else None

    header = {
        "fecha":     grab(r"Fecha:\s*(.*)"),
        "programa":  grab(r"PROGRAMA:\s*(.*)"),
        "plan":      grab(r"PLAN:\s*(\d+)"),
        "unidad":    grab(r"UNIDAD:\s*(.*)"),
        "expediente":grab(r"EXPEDIENTE:\s*([0-9]+)"),
        "alumno":    grab(r"EXPEDIENTE:\s*[0-9]+\s+(.*)"),
        "estatus":   grab(r"ESTATUS:\s*(.*)"),
    }
    return {k: v for k, v in header.items() if v}


# ============================================================
# 2) MATERIAS (vía tablas)
# ============================================================
def extract_subject_rows(path: Path) -> list:
    """
    Extrae las filas de materias leyendo las tablas de cada página.
    Estructura esperada por fila (11 columnas):
      CR, CVE, MATERIA, E1, E2, ORD, REG, CIC, I, R, B
    - Deduplica preservando orden.
    """
    materias = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            # Primero: extracción default
            tables = page.extract_tables() or []
            # Si quieres ser más agresivo, agrega table_settings:
            # tables += page.extract_tables(table_settings={
            #     "vertical_strategy": "lines", "horizontal_strategy": "lines"
            # }) or []

            for t in tables:
                for row in t:
                    if not row or len(row) < 3:
                        continue

                    # Limpia celdas
                    cells = [(c or "").strip() for c in row]

                    # Heurística mínima para fila de materias
                    CR = cells[0] if len(cells) > 0 else ""
                    CVE = cells[1] if len(cells) > 1 else ""
                    MAT = cells[2] if len(cells) > 2 else ""
                    if not (re.fullmatch(r"\d{2}", CR) and re.fullmatch(r"[A-Z0-9]{3,6}", CVE) and MAT):
                        continue

                    E1  = cells[3]  if len(cells) > 3  else None
                    E2  = cells[4]  if len(cells) > 4  else None
                    ORD = cells[5]  if len(cells) > 5  else None
                    REG = cells[6]  if len(cells) > 6  else None
                    CIC = cells[7]  if len(cells) > 7  else None
                    I   = cells[8]  if len(cells) > 8  else None
                    R   = cells[9]  if len(cells) > 9  else None
                    B   = cells[10] if len(cells) > 10 else None

                    materias.append({
                        "CR": CR,
                        "CVE": CVE,
                        "Materia": MAT,
                        "E1": E1 or None,
                        "E2": E2 or None,
                        "ORD": ORD or None,
                        "REG": REG or None,
                        "CIC": CIC or None,
                        "I": I or None,
                        "R": R or None,
                        "B": B or None,
                    })

    # Deduplicar por (CR, CVE, Materia, CIC)
    seen, dedup = set(), []
    for m in materias:
        key = (m["CR"], m["CVE"], m["Materia"], m["CIC"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(m)
    return dedup


# ============================================================
# 3) RESUMEN (PROMEDIO / CRÉDITOS / MATERIAS)
# ============================================================
def extract_summary(raw_text: str) -> dict:
    """
    Busca en el texto las cifras de:
      - PROMEDIO por periodo (ej. 2025-1 93.33)
      - PROMEDIO KARDEX (si aparece)
      - CRÉDITOS APR/REP/INS
      - MATERIAS APR/REP/NMR/INS
    Usa ventanas alrededor de las palabras clave porque
    a veces el PDF fragmenta saltos de línea.
    """
    resumen = {"promedios": {}, "creditos": {}, "materias": {}}

    def block_after(keyword: str, radius=600) -> str:
        up = raw_text.upper()
        i = up.find(keyword.upper())
        if i == -1: return ""
        return raw_text[i:i+radius]

    # --- Promedios ---
    # Ej. "2025-1" seguido de un número con decimal (con o sin asterisco)
    m_per = re.search(r"(\d{4}-\d)\s+\*?(\d{2,3}[.,]\d{1,2})", raw_text)
    if m_per:
        periodo = m_per.group(1)
        val = float(m_per.group(2).replace(",", "."))
        resumen["promedios"][periodo] = val

    m_k = re.search(r"KARDEX\D+(\*?\d{2,3}[.,]\d{1,2})", raw_text, re.I | re.S)
    if m_k:
        resumen["promedios"]["kardex"] = float(m_k.group(1).replace("*", "").replace(",", "."))

    # --- Créditos (busca cerca de 'CREDITOS') ---
    cred_region = block_after("CREDITOS")
    if cred_region:
        m_apr = re.search(r"APR\D+(\d+)", cred_region, re.I | re.S)
        m_rep = re.search(r"REP\D+(\d+)", cred_region, re.I | re.S)
        m_ins = re.search(r"INS\D+(\d+)", cred_region, re.I | re.S)
        if m_apr: resumen["creditos"]["APR"] = int(m_apr.group(1))
        if m_rep: resumen["creditos"]["REP"] = int(m_rep.group(1))
        if m_ins: resumen["creditos"]["INS"] = int(m_ins.group(1))

    # --- Materias (busca cerca de 'MATERIAS') ---
    mat_region = block_after("MATERIAS")
    if mat_region:
        m_apr2 = re.search(r"APR\D+(\d+)", mat_region, re.I | re.S)
        m_rep2 = re.search(r"REP\D+(\d+)", mat_region, re.I | re.S)
        m_nmr2 = re.search(r"NMR\D+(\d+)", mat_region, re.I | re.S)
        m_ins2 = re.search(r"INS\D+(\d+)", mat_region, re.I | re.S)
        if m_apr2: resumen["materias"]["APR"] = int(m_apr2.group(1))
        if m_rep2: resumen["materias"]["REP"] = int(m_rep2.group(1))
        if m_nmr2: resumen["materias"]["NMR"] = int(m_nmr2.group(1))
        if m_ins2: resumen["materias"]["INS"] = int(m_ins2.group(1))

    # Limpieza de vacíos
    if not resumen["creditos"]:
        del resumen["creditos"]
        resumen["creditos"] = {}
    if not resumen["materias"]:
        del resumen["materias"]
        resumen["materias"] = {}

    return resumen


# ============================================================
# 4) CLI
# ============================================================
def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "PDF path missing"}))
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(json.dumps({"ok": False, "error": f"No existe el archivo: {pdf_path}"}))
        sys.exit(1)

    try:
        raw_text = read_text(pdf_path)
        alumno = extract_header(raw_text)
        materias = extract_subject_rows(pdf_path)
        resumen = extract_summary(raw_text)

        out = {
            "ok": True,
            "alumno": alumno,
            "materias": materias,
            "resumen": resumen,
        }
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
