import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { Perfis } from '../../common/decorators/auth.decorators';
import { AtualizarProdutoDto, CriarProdutoDto, FiltroProdutosDto, SugestaoPrecoQueryDto } from './dto/produto.dto';
import { ProdutosService } from './produtos.service';

@ApiTags('produtos')
@ApiBearerAuth()
@Controller('produtos')
export class ProdutosController {
  constructor(private readonly service: ProdutosService) {}

  @Get()
  listar(@Query() filtro: FiltroProdutosDto) {
    return this.service.listar(filtro);
  }

  @Get('estoque-baixo')
  @ApiOperation({ summary: 'Produtos com estoque atual ≤ estoque mínimo' })
  estoqueBaixo() {
    return this.service.estoqueBaixo();
  }

  @Get(':id')
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(id);
  }

  @Perfis(Perfil.ADMIN)
  @Get(':id/sugestao-preco')
  @ApiOperation({ summary: 'Preço de venda para atingir a margem desejada sobre o custo atual' })
  sugestaoPreco(@Param('id', ParseUUIDPipe) id: string, @Query() q: SugestaoPrecoQueryDto) {
    return this.service.sugestaoPreco(id, q.margem);
  }

  @Perfis(Perfil.ADMIN)
  @Post()
  criar(@Body() dto: CriarProdutoDto) {
    return this.service.criar(dto);
  }

  @Perfis(Perfil.ADMIN)
  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarProdutoDto) {
    return this.service.atualizar(id, dto);
  }

  @Perfis(Perfil.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desativa o produto (exclusão lógica)' })
  desativar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.desativar(id);
  }
}
