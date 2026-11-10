import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '../../domain/decimal';
import { RegraNegocioError } from '../../domain/errors';
import { custoMedioPonderado, validarQuantidade } from '../../domain/estoque.rules';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { travarProdutos } from '../../common/travar-produtos';
import { PrismaService } from '../../prisma/prisma.service';
import { CriarCompraDto } from './compras.dto';

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a compra: soma ao estoque e recalcula o custo médio ponderado
   * de cada produto, tudo numa transação com os produtos bloqueados.
   */
  async criar(dto: CriarCompraDto, usuarioId: string) {
    dto.itens.forEach((i) => validarQuantidade(i.quantidade));
    const ids = dto.itens.map((i) => i.produtoId);

    return this.prisma.$transaction(async (tx) => {
      const fornecedor = await tx.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
      if (!fornecedor) throw new NotFoundException('Fornecedor não encontrado');

      await travarProdutos(tx, ids);
      const produtos = await tx.produto.findMany({ where: { id: { in: ids } } });
      const porId = new Map(produtos.map((p) => [p.id, { ...p }]));

      let valorTotal = new Decimal(0);
      // Itens repetidos são aplicados em sequência, cada um sobre o estado já atualizado
      for (const item of dto.itens) {
        const p = porId.get(item.produtoId);
        if (!p) throw new NotFoundException(`Produto ${item.produtoId} não encontrado`);
        if (!p.ativo) throw new RegraNegocioError(`O produto "${p.nome}" está inativo`);
        p.precoCusto = custoMedioPonderado(p.estoqueAtual, p.precoCusto, item.quantidade, item.custoUnitario);
        p.estoqueAtual += item.quantidade;
        valorTotal = valorTotal.add(new Decimal(item.custoUnitario).mul(item.quantidade));
      }

      for (const p of porId.values()) {
        await tx.produto.update({
          where: { id: p.id },
          data: { estoqueAtual: p.estoqueAtual, precoCusto: p.precoCusto },
        });
      }

      return tx.compra.create({
        data: {
          fornecedorId: dto.fornecedorId,
          usuarioId,
          valorTotal: valorTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          itens: {
            create: dto.itens.map((i) => ({
              produtoId: i.produtoId,
              quantidade: i.quantidade,
              custoUnitario: i.custoUnitario,
            })),
          },
        },
        include: { itens: true, fornecedor: { select: { id: true, nome: true } } },
      });
    });
  }

  async listar(p: PaginacaoDto) {
    const [dados, total] = await Promise.all([
      this.prisma.compra.findMany({
        include: { fornecedor: { select: { id: true, nome: true } } },
        orderBy: { data: 'desc' },
        skip: p.skip,
        take: p.limite,
      }),
      this.prisma.compra.count(),
    ]);
    return { dados, total, pagina: p.pagina, limite: p.limite };
  }

  async buscar(id: string) {
    const compra = await this.prisma.compra.findUnique({
      where: { id },
      include: {
        fornecedor: { select: { id: true, nome: true } },
        itens: { include: { produto: { select: { id: true, nome: true } } } },
      },
    });
    if (!compra) throw new NotFoundException('Compra não encontrada');
    return compra;
  }
}
