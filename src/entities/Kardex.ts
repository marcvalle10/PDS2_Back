import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "kardex" })
export class Kardex {
    @PrimaryGeneratedColumn() id!: number;
    @Column({ name: "alumno_id", type: "int" }) alumno_id!: number;
    @Column({ name: "materia_id", type: "int" }) materia_id!: number;
    @Column({ name: "periodo_id", type: "int" }) periodo_id!: number;
    @Column({ type: "numeric", nullable: true }) calificacion!: number | null;
    @Column() estatus!: string;
    @Column({ name: "promedio_kardex", type: "int", default: 0 }) promedio_kardex!: number;
    @Column({ name: "promedio_sem_act", type: "int", default: 0 }) promedio_sem_act!: number;
    @Column({ type: "text", nullable: true }) filename!: string | null;
}
