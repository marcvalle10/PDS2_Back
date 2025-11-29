import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'docentes' })
export class Docente {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 200 })
  nombre!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  noEmpleado!: string | null;
}
