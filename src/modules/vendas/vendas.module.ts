import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { Perfis, UsuarioAtual, UsuarioAutenticado } from '../../common/decorators/auth.decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { CancelarVendaDto, CriarVendaDto } from './vendas.dto';
import { VendasService } from './vendas.service';

@ApiTags('vendas')
@ApiBearerAuth()
@Controller('vendas')
export class VendasController {
  constructor(private readonly service: VendasService) {}

  @Post()
  @ApiOperation({ summary: 'Registra venda (baixa estoque e grava o custo do momento para o lucro)' })
  criar(@Body() dto: CriarVendaDto, @UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.criar(dto, usuario.id);
  }

  @Perfis(Perfil.ADMIN)
  @Post(':id/cancelar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela a venda (somente ADMIN): devolve o estoque e a tira dos relatórios' })
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarVendaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.service.cancelar(id, usuario.id, dto.motivo);
  }

  @Get()
  listar(@Query() p: PaginacaoDto) {
    return this.service.listar(p);
  }

  @Get(':id')
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(id);
  }
}

@Module({
  controllers: [VendasController],
  providers: [VendasService],
})
export class VendasModule {}
