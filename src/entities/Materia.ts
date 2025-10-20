import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "materia" })
export class Materia {
    @PrimaryGeneratedColumn() id!: number;
    @Column({ unique: true }) codigo!: string;
    @Column() nombre!: string;
    @Column({ type: "int" }) creditos!: number;
    @Column() tipo!: string; // USER-DEFINED en DB, aquí text
    @Column({ name: "plan_estudio_id", type: "int" }) plan_estudio_id!: number;
}
