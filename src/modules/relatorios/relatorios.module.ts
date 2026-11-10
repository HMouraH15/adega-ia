import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Perfis } from '../../common/decorators/auth.decorators';
import { PeriodoDto } from '../../common/dto/periodo.dto';
import { Agrupamento, CriterioRanking, RelatoriosService } from './relatorios.service';

class VendasPorPeriodoDto extends PeriodoDto {
  @ApiPropertyOptional({ enum: ['dia', 'semana', 'mes'], default: 'dia' })
  @IsOptional()
  @IsIn(['dia', 'semana', 'mes'])
  agrupamento: Agrupamento = 'dia';
}

class MaisVendidosDto extends PeriodoDto {
  @ApiPropertyOptional({ enum: ['quantidade', 'receita', 'lucro'], default: 'quantidade' })
  @IsOptional()
  @IsIn(['quantidade', 'receita', 'lucro'])
  criterio: CriterioRanking = 'quantidade';

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limite = 10;
}

class ReposicaoDto {
  @ApiPropertyOptional({ default: 30, description: 'Dias de histórico para a média de vendas' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  diasHistorico = 30;

  @ApiPropertyOptional({ default: 15, description: 'Dias de venda que a reposição deve cobrir' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  diasCobertura = 15;
}

@ApiTags('relatorios')
@ApiBearerAuth()
@Perfis(Perfil.ADMIN)
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get('lucro')
  @ApiOperation({ summary: 'Receita, custo, lucro e margem no período' })
  lucro(@Query() q: PeriodoDto) {
    return this.service.lucro(q.inicio, q.fim);
  }

  @Get('vendas')
  @ApiOperation({ summary: 'Vendas agrupadas por dia, semana ou mês' })
  vendas(@Query() q: VendasPorPeriodoDto) {
    return this.service.vendasPorPeriodo(q.inicio, q.fim, q.agrupamento);
  }

  @Get('mais-vendidos')
  maisVendidos(@Query() q: MaisVendidosDto) {
    return this.service.maisVendidos(q.inicio, q.fim, q.criterio, q.limite);
  }

  @Get('reposicao')
  @ApiOperation({ summary: 'Sugestão de reposição pela média de vendas diárias' })
  reposicao(@Query() q: ReposicaoDto) {
    return this.service.sugestaoReposicao(q.diasHistorico, q.diasCobertura);
  }
}

@Module({
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
  exports: [RelatoriosService],
})
export class RelatoriosModule {}
