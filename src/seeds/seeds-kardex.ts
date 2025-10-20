// import "dotenv/config";
// import { AppDataSource } from "../config/data-source";
// import { ingestarKardex } from "../services/ingestaKardex";

// // Pega aquí el JSON que nos mostraste (o impórtalo desde un archivo)
// const payload = /* tu JSON del controlador */;

// async function main() {
//     try {
//         if (!AppDataSource.isInitialized) {
//             await AppDataSource.initialize();
//         }
//         const res = await ingestarKardex(payload as any);
//         console.log("Seed OK:", res);
//     } catch (e) {
//         console.error("Seed error:", e);
//         process.exit(1);
//     } finally {
//         if (AppDataSource.isInitialized) await AppDataSource.destroy();
//     }
// }

// main();
