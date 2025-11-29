import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'grupos' })
export class Grupo {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  periodoId!: number | null;

  @Index()
  @Column({ type: 'varchar', length: 32, nullable: true })
  materiaCodigo!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 32, nullable: true })
  materiaClave!: string | null;

  @Column({ type: 'varchar', length: 300 })
  nombreMateria!: string;

  @Index()
  @Column({ type: 'varchar', length: 32, nullable: true })
  grupo!: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  nrc!: string | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  profesorId!: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  aula!: string | null;

  @Column({ type: 'int', nullable: true })
  inscritos!: number | null;
}
