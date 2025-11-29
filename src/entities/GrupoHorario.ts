import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'grupos_horarios' })
export class GrupoHorario {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  grupoId!: number;

  @Column({ type: 'varchar', length: 3 })
  dia!: 'LUN'|'MAR'|'MIE'|'JUE'|'VIE'|'SAB';

  @Column({ type: 'varchar', length: 5 })
  horaInicio!: string; // HH:MM

  @Column({ type: 'varchar', length: 5 })
  horaFin!: string;    // HH:MM
}
