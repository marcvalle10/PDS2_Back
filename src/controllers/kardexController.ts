
import { Request, Response } from "express";
import path from "path";
import { runPythonKardex } from "../utils/runPythonKardex";
import { AppDataSource } from "../config/data-source";
import { ArchivoCargado } from "../entities/ArchivoCargado";
import { AuditoriaCargas } from "../entities/AuditoriaCargas";
import { ingestarKardex } from "../services/ingestaKardex";
import { sha256File } from "../utils/fileHash";

export const kardexController = {
    uploadFile: async (req: Request, res: Response) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No se recibio ningun archivo." });
            }

            const absPath = path.resolve(req.file.path);
            const usuario = (req as any).user?.email ?? "anon";
            const nombreArchivo = req.file.originalname;
            const hash = await sha256File(absPath);

            // 1) Registramos el archivo + auditoría inicial
            const archivoRepo = AppDataSource.getRepository(ArchivoCargado);
            const auditRepo = AppDataSource.getRepository(AuditoriaCargas);

            // const archivo = await archivoRepo.save(
            //     archivoRepo.create({
            //         tipo: "KARDEX",
            //         nombre_archivo: nombreArchivo,
            //         hash,
            //         usuario,
            //         estado_proceso: "PENDIENTE",
            //     })
            // );
            const archivo = await archivoRepo.save(
                archivoRepo.create({
                    tipo: "KARDEX",
                    nombre_archivo: nombreArchivo,
                    stored_name: req.file.filename,
                    mime_type: req.file.mimetype,
                    size_bytes: req.file.size, // si usaste transformer a number, queda perfecto
                    storage_path: `/uploads/${req.file.filename}`,
                    hash,
                    usuario,
                    estado_proceso: "PENDIENTE",
                }) as ArchivoCargado
            );

            await auditRepo.save(
                auditRepo.create({
                    archivo_id: archivo.id,
                    etapa: "UPLOAD",
                    estado: "OK",
                    detalle: `Guardado como ${req.file.filename}`,
                })
            );

            // 2) Parseamos con Python
            const py = await runPythonKardex(absPath);
            if (!py?.ok) {
                await auditRepo.save(
                    auditRepo.create({
                        archivo_id: archivo.id,
                        etapa: "PARSE",
                        estado: "ERROR",
                        detalle: py?.error || "Formato de Kárdex no reconocido",
                    })
                );
                await archivoRepo.update(archivo.id, { estado_proceso: "ERROR" });

                return res.status(400).json({
                    status: "error",
                    isValid: false,
                    message: [py?.error || "Formato de Kárdex no reconocido"],
                    file: {
                        name: req.file.originalname,
                        path: `/uploads/${req.file.filename}`,
                    },
                });
            }

            await auditRepo.save(
                auditRepo.create({
                    archivo_id: archivo.id,
                    etapa: "PARSE",
                    estado: "OK",
                    detalle: `Materias: ${py.materias?.length ?? 0}`,
                })
            );

            // 3) Ingesta a la BD (plan, alumno, periodo, materia, kardex)
            let ingestaResultado: any;
            try {
                ingestaResultado = await ingestarKardex(py);
                await auditRepo.save(
                    auditRepo.create({
                        archivo_id: archivo.id,
                        etapa: "INGESTA",
                        estado: "OK",
                        detalle: JSON.stringify({
                            alumnoId: ingestaResultado?.alumnoId,
                            planId: ingestaResultado?.planId,
                        }),
                    })
                );
                await archivoRepo.update(archivo.id, { estado_proceso: "COMPLETADO" });
            } catch (e: any) {
                await auditRepo.save(
                    auditRepo.create({
                        archivo_id: archivo.id,
                        etapa: "INGESTA",
                        estado: "ERROR",
                        detalle: e?.message?.substring(0, 800) || "Error en ingesta",
                    })
                );
                await archivoRepo.update(archivo.id, { estado_proceso: "ERROR" });
                return res.status(500).json({ status: "error", message: "Error al insertar datos del Kardex." });
            }

            // 4) Respuesta
            return res.status(200).json({
                status: "uploaded",
                isValid: true,
                message: "Kardex cargado e insertado correctamente.",
                alumno: py.alumno,
                resumen: py.resumen,
                materiasCount: py.materias?.length ?? 0,
                file: {
                    name: req.file.originalname,
                    storedName: req.file.filename,
                    path: `/uploads/${req.file.filename}`,
                    mimeType: req.file.mimetype,
                    sizeBytes: req.file.size,
                    hash,
                },
                ingesta: ingestaResultado,
            });
        } catch (error) {
            console.error("Error al subir el archivo: ", error);
            return res.status(500).json({
                error: "Error interno al subir el archivo",
            });
        }
    },

    
};
// import { Request, Response } from "express";
// import path from "path";
// import { runPythonKardex } from "../utils/runPythonKardex";

// export const kardexController = {
//     uploadFile: async (req: Request, res: Response) => {
//         try {
//             if (!req.file) {
//                 return res.status(400).json({ error: "No se recibio ningun archivo." });
//             }

//             const absPath = path.resolve(req.file.path);
//             const py = await runPythonKardex(absPath);

//             if (!py?.ok) {
//                 return res.status(400).json({
//                     status: "error",
//                     isValid: false,
//                     message: [py?.error || "Formato de Kárdex no reconocido"],
//                     file: {
//                         name: req.file.originalname,
//                         path: `/uploads/${req.file.filename}`,
//                     },
//                 });
//             }

//             console.log(py);
//             console.log(py.materias);
//             console.log(py.resumen.creditos);

//             return res.status(200).json({
//                 status: "uploaded",
//                 isValid: true,
//                 message: "Kardex cargado correctamente.",
//                 // alumno: py.alumno,
//                 // materias: py.materias,
//                 // resumen: py.resumen,
//                 // file: {
//                 //     name: req.file.originalname,
//                 //     storedName: req.file.filename,
//                 //     path: `/uploads/${req.file.filename}`,
//                 //     mimeType: req.file.mimetype,
//                 //     sizeBytes: req.file.size,
//                 // },
//             });
//         } catch (error) {
//             console.error("Error al subir el archivo: ", error);
//             return res.status(500).json({
//                 error: "Error interno al subir el archivo,",
//             })
//         }
//     }
// }