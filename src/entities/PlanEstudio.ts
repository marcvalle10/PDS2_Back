import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "plan_estudio" })
export class PlanEstudio {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  nombre!: string;

  @Column({ type: "text" })
  version!: string;

  @Column({ name: "total_creditos", type: "int", default: 0 })
  totalCreditos!: number;

  @Column({ name: "semestres_sugeridos", type: "int", default: 0 })
  semestresSugeridos!: number;
}
