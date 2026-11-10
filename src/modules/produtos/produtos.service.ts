import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AtualizarProdutoDto, CriarProdutoDto, FiltroProdutosDto } from './dto/produto.dto';

const comCategoria = { categoria: { select: { id: true, nome: true } } } as const;

@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(f: FiltroProdutosDto) {
    const where: Prisma.ProdutoWhereInput = {
      ativo: f.ativo,
      categoriaId: f.categoriaId,
      nome: f.termo ? { contains: f.termo, mode: 'insensitive' } : undefined,
    };
    const [dados, total] = await Promise.all([
      this.prisma.produto.findMany({ where, include: comCategoria, orderBy: { nome: 'asc' }, skip: f.skip, take: f.limite }),
      this.prisma.produto.count({ where }),
    ]);
    return { dados, total, pagina: f.pagina, limite: f.limite };
  }

  async buscar(id: string) {
    const produto = await this.prisma.produto.findUnique({ where: { id }, include: comCategoria });
    if (!produto) throw new NotFoundException('Produto não encontrado');
    return produto;
  }

  criar(dto: CriarProdutoDto) {
    return this.prisma.produto.create({ data: { ...dto, nome: dto.nome.trim() }, include: comCategoria });
  }

  async atualizar(id: string, dto: AtualizarProdutoDto) {
    await this.buscar(id);
    return this.prisma.produto.update({ where: { id }, data: dto, include: comCategoria });
  }

  /** Exclusão lógica: preserva o histórico de compras e vendas. */
  async desativar(id: string) {
    await this.buscar(id);
    await this.prisma.produto.update({ where: { id }, data: { ativo: false } });
  }

  /** Produtos ativos com estoque atual menor ou igual ao mínimo. */
  estoqueBaixo(limite = 100) {
    return this.prisma.produto.findMany({
      where: { ativo: true, estoqueAtual: { lte: this.prisma.produto.fields.estoqueMinimo } },
      include: comCategoria,
      orderBy: [{ estoqueAtual: 'asc' }, { nome: 'asc' }],
      take: limite,
    });
  }
}
