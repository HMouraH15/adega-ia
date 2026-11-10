import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags, PartialType } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Perfis } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';

export class CriarCategoriaDto {
  @ApiProperty({ example: 'Vinhos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nome: string;
}

export class AtualizarCategoriaDto extends PartialType(CriarCategoriaDto) {}

@Injectable()
export class CategoriasService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.categoria.findMany({ orderBy: { nome: 'asc' } });
  }

  buscar(id: string) {
    return this.prisma.categoria.findUniqueOrThrow({ where: { id } });
  }

  criar(dto: CriarCategoriaDto) {
    return this.prisma.categoria.create({ data: { nome: dto.nome.trim() } });
  }

  atualizar(id: string, dto: AtualizarCategoriaDto) {
    return this.prisma.categoria.update({ where: { id }, data: { nome: dto.nome?.trim() } });
  }

  /** Falha com 409 se houver produtos na categoria (P2003). */
  remover(id: string) {
    return this.prisma.categoria.delete({ where: { id } });
  }
}

@ApiTags('categorias')
@ApiBearerAuth()
@Controller('categorias')
export class CategoriasController {
  constructor(private readonly service: CategoriasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Get(':id')
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.buscar(id);
  }

  @Perfis(Perfil.ADMIN)
  @Post()
  criar(@Body() dto: CriarCategoriaDto) {
    return this.service.criar(dto);
  }

  @Perfis(Perfil.ADMIN)
  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCategoriaDto) {
    return this.service.atualizar(id, dto);
  }

  @Perfis(Perfil.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remover(id);
  }
}

@Module({
  controllers: [CategoriasController],
  providers: [CategoriasService],
})
export class CategoriasModule {}
