import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "archivo_cargado" })
export class ArchivoCargado {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: "text" })                 // <-- explícito
    tipo!: string;

    @Column({ name: "nombre_archivo", type: "text" })
    nombre_archivo!: string;

    @Column({ type: "text", nullable: true }) // <-- explícito
    stored_name!: string | null;

    @Column({ type: "text", nullable: true }) // <-- explícito
    mime_type!: string | null;

    @Column({
        type: "bigint",
        nullable: true,
        transformer: {
            to: (v?: number | null) => (v ?? null),
            from: (v: string | null) => (v == null ? null : Number(v)),
        },
    })
    size_bytes!: number | null;

    @Column({ type: "text", nullable: true }) // <-- explícito
    storage_path!: string | null;

    @Column({ type: "text" })                 // <-- explícito
    hash!: string;

    @Column({ type: "text" })                 // <-- explícito
    usuario!: string;

    @Column({ type: "timestamptz", default: () => "now()" })
    fecha!: Date;

    @Column({ name: "estado_proceso", type: "text", default: "PENDIENTE" })
    estado_proceso!: string;
}
