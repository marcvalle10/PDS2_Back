import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "plan_estudio" })
export class PlanEstudio {
    @PrimaryGeneratedColumn() id!: number;
    @Column() nombre!: string;
    @Column() version!: string;
    @Column({ name: "total_creditos", type: "int" }) total_creditos!: number;
    @Column({ name: "semestres_sugeridos", type: "int" }) semestres_sugeridos!: number;
}
