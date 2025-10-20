import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "auditoria_cargas" })
export class AuditoriaCargas {
    @PrimaryGeneratedColumn() id!: number;

    @Column({ name: "archivo_id", type: "int" }) archivo_id!: number;
    @Column() etapa!: string;   // p.ej. "UPLOAD", "PARSE", "INGESTA"
    @Column() estado!: string;  // "OK" | "ERROR"
    @Column({ type: "timestamptz", default: () => "now()" })
    timestamp!: Date;

    @Column({ type: "text", nullable: true }) detalle!: string | null;
}
