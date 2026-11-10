import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { Perfis, UsuarioAtual, UsuarioAutenticado } from '../../common/decorators/auth.decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { CriarCompraDto } from './compras.dto';
import { ComprasService } from './compras.service';

@ApiTags('compras')
@ApiBearerAuth()
@Perfis(Perfil.ADMIN)
@Controller('compras')
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  @Post()
  @ApiOperation({ summary: 'Registra compra de fornecedor (aumenta estoque e recalcula custo médio)' })
  criar(@Body() dto: CriarCompraDto, @UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.criar(dto, usuario.id);
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
  controllers: [ComprasController],
  providers: [ComprasService],
})
export class ComprasModule {}
