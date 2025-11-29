#!/usr/bin/env node

/**
 * Subir y procesar el Excel de estructura en un solo paso.
 * Uso:
 *   node scripts/procesar-estructura.js --file "ruta/al/archivo.xlsx" [--baseUrl "http://localhost:3000"]
 * Tip: también puedes definir BASE_URL en tu .env
 */

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
    }
    return out;
}

async function main() {
    const { file, baseUrl } = parseArgs();
    const BASE_URL = baseUrl || process.env.BASE_URL || 'http://localhost:5000';

    if (!file) {
        console.error('❌ Falta el parámetro --file "ruta/al/archivo.xlsx"');
        process.exit(1);
    }

    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) {
        console.error(`❌ No existe el archivo: ${abs}`);
        process.exit(1);
    }

    console.log(`➡️  Usando BASE_URL: ${BASE_URL}`);
    console.log(`📄 Archivo: ${abs}`);

    // 1) Subir
    const form = new FormData();
    form.append('file', fs.createReadStream(abs), path.basename(abs));

    console.log('⬆️  Subiendo archivo…');
    const up = await axios.post(`${BASE_URL}/estructura/upload`, form, {
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

    // 2) Procesar
    console.log('⚙️  Procesando…');
    const proc = await axios.post(`${BASE_URL}/estructura/process/${archivoId}`);
    if (!proc.data || proc.data.ok !== true) {
        console.error('❌ Error en process:', proc.data);
        process.exit(1);
    }

    const res = proc.data.resumen || {};
    console.log('✅ Proceso completado.');
    console.log(`   • Alumnos upsert: ${res.alumnosUpsert ?? 0}`);
    console.log(`   • Planes upsert:  ${res.planesUpsert ?? 0}`);
    const warns = res.warnings || [];
    console.log(`   • Warnings:       ${warns.length}`);
    if (warns.length) {
        console.log('   Primeros warnings:');
        console.log(warns.slice(0, 10).map((w, i) => `     ${i + 1}. ${w}`).join('\n'));
    }
}

main().catch((err) => {
    const resp = err && err.response ? err.response.data : null;
    const msg = err && err.message ? err.message : null;
    console.error('💥 Error ejecutando el script:', resp || msg || err);
    process.exit(1);
});