#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if ((a === '--file' || a === '-f') && args[i + 1]) out.file = args[++i];
        else if ((a === '--baseUrl' || a === '-u') && args[i + 1]) out.baseUrl = args[++i];
        else if ((a === '--periodo' || a === '-p') && args[i + 1]) out.periodo = args[++i];
    }
    return out;
}

async function main() {
    const { file, baseUrl, periodo } = parseArgs();
    const BASE_URL = baseUrl || process.env.BASE_URL || 'http://localhost:5000';

    if (!file) {
        console.error('❌ Falta el parámetro --file "ruta/al/archivo.xlsx"');
        process.exit(1);
    }
    if (!periodo) {
        console.error('❌ Falta el parámetro --periodo "2025-1"');
        process.exit(1);
    }

    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) {
        console.error(`❌ No existe el archivo: ${abs}`);
        process.exit(1);
    }

    console.log(`➡️  Usando BASE_URL: ${BASE_URL}`);
    console.log(`📄 Archivo: ${abs}`);
    console.log(`📆 Periodo: ${periodo}`);

    const form = new FormData();
    form.append('file', fs.createReadStream(abs), path.basename(abs));

    console.log('⬆️  Subiendo archivo…');
    const up = await axios.post(`${BASE_URL}/asistencia/upload`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    if (!up.data || up.data.ok !== true) {
        console.error('❌ Error en upload:', up.data);
        process.exit(1);
    }

    const archivoId = up.data.archivoId;
    console.log(`✅ Upload OK. archivoId = ${archivoId}`);

    console.log('⚙️  Procesando…');
    const proc = await axios.post(`${BASE_URL}/asistencia/process/${archivoId}`, {
        periodoEtiqueta: periodo,
    });

    if (!proc.data || proc.data.ok !== true) {
        console.error('❌ Error en process:', proc.data);
        process.exit(1);
    }

    const r = proc.data.resumen || {};
    console.log('✅ Proceso completado.');
    console.log(`   • Alumnos vinculados:    ${r.alumnosVinculados ?? 0}`);
    console.log(`   • Sin alumno en sistema: ${r.alumnosSinAlumno ?? 0}`);
    console.log(`   • Sin grupo encontrado:  ${r.alumnosSinGrupo ?? 0}`);
    const warns = r.warnings || [];
    if (warns.length) {
        console.log('   • Warnings:', warns.length);
        console.log(warns.slice(0, 10).map((w, i) => `     ${i + 1}. ${w}`).join('\n'));
    }
}

main().catch((err) => {
    const resp = err && err.response ? err.response.data : null;
    const msg = err && err.message ? err.message : null;
    console.error('💥 Error ejecutando el script:', resp || msg || err);
    process.exit(1);
});