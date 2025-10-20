// src/entities/Alumno.ts
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "alumno" })
export class Alumno {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: "text" })
    matricula!: string;

    @Column({ type: "text" })
    expediente!: string;

    @Column({ type: "text" })
    nombre!: string;

    @Column({ name: "apellido_paterno", type: "text" })
    apellido_paterno!: string;

    @Column({ name: "apellido_materno", type: "text", nullable: true })
    apellido_materno!: string | null;

    @Column({ type: "text" })
    correo!: string;

    // USER-DEFINED en DB → usa text en la entidad
    @Column({ name: "estado_academico", type: "text" })
    estado_academico!: string;

    @Column({ name: "nivel_ingles_actual", type: "text", nullable: true })
    nivel_ingles_actual!: string | null;

    @Column({ name: "plan_estudio_id", type: "int" })
    plan_estudio_id!: number;

    @Column({ name: "total_creditos", type: "int", default: 0 })
    total_creditos!: number;
}
