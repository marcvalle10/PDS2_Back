import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "periodo" })
export class Periodo {
    @PrimaryGeneratedColumn() id!: number;
    @Column({ type: "int" }) anio!: number;
    @Column({ type: "int" }) ciclo!: number;
    @Column({ unique: true }) etiqueta!: string;
    @Column({ name: "fecha_inicio", type: "date" }) fecha_inicio!: string; // YYYY-MM-DD
    @Column({ name: "fecha_fin", type: "date" }) fecha_fin!: string;       // YYYY-MM-DD
}
