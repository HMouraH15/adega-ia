import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodoDto {
  @ApiProperty({ example: '2026-11-01', description: 'Data inicial (AAAA-MM-DD), inclusiva' })
  @Matches(DATA, { message: 'inicio deve estar no formato AAAA-MM-DD' })
  inicio: string;

  @ApiProperty({ example: '2026-11-30', description: 'Data final (AAAA-MM-DD), inclusiva' })
  @Matches(DATA, { message: 'fim deve estar no formato AAAA-MM-DD' })
  fim: string;
}
