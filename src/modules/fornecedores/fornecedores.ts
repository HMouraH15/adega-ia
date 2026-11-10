import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Perfis } from '../../common/decorators/auth.decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { PrismaService } from '../../prisma/prisma.service';

export class CriarFornecedorDto {
  @ApiProperty({ example: 'Distribuidora Serra Gaúcha' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nome: string;

  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  documento?: string;

  @ApiPropertyOptional({ example: '(54) 99999-0000' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contato?: string;
}

export class AtualizarFornecedorDto extends PartialType(CriarFornecedorDto) {}

@Injectable()
export class FornecedoresService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(p: PaginacaoDto) {
    const [dados, total] = await Promise.all([
      this.prisma.fornecedor.findMany({ orderBy: { nome: 'asc' }, skip: p.skip, take: p.limite }),
      this.prisma.fornecedor.count(),
    ]);
    return { dados, total, pagina: p.pagina, limite: p.limite };
  }

  buscar(id: string) {
    return this.prisma.fornecedor.findUniqueOrThrow({ where: { id } });
  }

  criar(dto: CriarFornecedorDto) {
    return this.prisma.fornecedor.create({ data: dto });
  }

  atualizar(id: string, dto: AtualizarFornecedorDto) {
    return this.prisma.fornecedor.update({ where: { id }, data: dto });
  }

  /** Falha com 409 se o fornecedor tiver compras (P2003). */
  remover(id: string) {
    return this.prisma.fornecedor.delete({ where: { id } });
  }
}

@ApiTags('fornecedores')
@ApiBearerAuth()
@Perfis(Perfil.ADMIN)
@Controller('fornecedores')
export class FornecedoresController {
  constructor(private readonly service: FornecedoresService) {}

  @Get()
  listar(@Query() p: PaginacaoDto) {
    return this.service.listar(p);
  }

  @Get(':id')
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(id);
  }

  @Post()
  criar(@Body() dto: CriarFornecedorDto) {
    return this.service.criar(dto);
  }

  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarFornecedorDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remover(id);
  }
}

@Module({
  controllers: [FornecedoresController],
  providers: [FornecedoresService],
  exports: [FornecedoresService],
})
export class FornecedoresModule {}
