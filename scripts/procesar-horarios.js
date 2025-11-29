#!/usr/bin/env node

/**
 * Subir y procesar HORARIOS (ISI.xlsx + Prelistas.xlsx) en un solo paso.
 * Uso:
 *   node scripts/procesar-horarios.js --isi "ruta/ISI.xlsx" --prelistas "ruta/Prelistas.xlsx" [--baseUrl "http://localhost:5000"]
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
        if (a === '--isi' && args[i + 1]) out.isi = args[++i];
        else if (a === '--prelistas' && args[i + 1]) out.prelistas = args[++i];
        else if ((a === '--baseUrl' || a === '-u') && args[i + 1]) out.baseUrl = args[++i];
    }
    return out;
}

async function main() {
    const { isi, prelistas, baseUrl } = parseArgs();
    const BASE_URL = baseUrl || process.env.BASE_URL || 'http://localhost:5000';

    if (!isi || !prelistas) {
        console.error('❌ Falta --isi y/o --prelistas');
        process.exit(1);
    }

    const absISI = path.resolve(isi);
    const absPre = path.resolve(prelistas);
    if (!fs.existsSync(absISI)) {
        console.error(`❌ No existe: ${absISI}`);
        process.exit(1);
    }
    if (!fs.existsSync(absPre)) {
        console.error(`❌ No existe: ${absPre}`);
        process.exit(1);
    }

    console.log(`➡️  Usando BASE_URL: ${BASE_URL}`);
    console.log(`📄 ISI:       ${absISI}`);
    console.log(`📄 Prelistas: ${absPre}`);

    // 1) Upload ambos
    const form = new FormData();
    form.append('isi', fs.createReadStream(absISI), path.basename(absISI));
    form.append('prelistas', fs.createReadStream(absPre), path.basename(absPre));

    console.log('⬆️  Subiendo archivos…');
    const up = await axios.post(`${BASE_URL}/horarios/upload`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
    });

    if (!up.data || up.data.ok !== true) {
        console.error('❌ Error en upload:', up.data);
        process.exit(1);
    }

    const data = up && up.data ? up.data : {};
    const archivoIdISI = data.isi ? data.isi.archivoId : undefined;
    const archivoIdPre = data.prelistas ? data.prelistas.archivoId : undefined;


    if (!archivoIdISI || !archivoIdPre) {
        console.error('❌ Respuesta inesperada del upload (faltan archivoId):', up.data);
        process.exit(1);
    }

    console.log(`✅ Upload OK. archivoIdISI=${archivoIdISI}  archivoIdPrelistas=${archivoIdPre}`);

    // 2) Procesar
    console.log('⚙️  Procesando…');
    const proc = await axios.post(
        `${BASE_URL}/horarios/process`, { archivoIdISI, archivoIdPrelistas: archivoIdPre }, { timeout: 180000 }
    );

    if (!proc.data || proc.data.ok !== true) {
        console.error('❌ Error en process:', proc.data);
        process.exit(1);
    }

    const r = proc.data.resumen || {};
    console.log('✅ Proceso completado.');
    console.log(`   • Grupos upsert:   ${r.gruposUpsert ?? 0}`);
    console.log(`   • Horarios upsert: ${r.horariosUpsert ?? 0}`);
    if (r.profCre || r.profUpd) {
        console.log(`   • Profesores cre:  ${r.profCre ?? 0}  upd: ${r.profUpd ?? 0}`);
    }
}

main().catch((err) => {
    const resp = err && err.response ? err.response.data : null;
    const msg = err && err.message ? err.message : null;
    console.error('💥 Error ejecutando el script:', resp || msg || err);
    process.exit(1);
});