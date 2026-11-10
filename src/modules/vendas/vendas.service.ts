import { Injectable, NotFoundException } from '@nestjs/common';
import { StatusVenda } from '@prisma/client';
import { EstoqueInsuficienteError, RegraNegocioError } from '../../domain/errors';
import { agruparItens, calcularBaixa, custoMedioPonderado } from '../../domain/estoque.rules';
import { calcularTotaisVenda } from '../../domain/lucro.rules';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { travarProdutos } from '../../common/travar-produtos';
import { PrismaService } from '../../prisma/prisma.service';
import { CriarVendaDto } from './vendas.dto';

@Injectable()
export class VendasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a venda: baixa o estoque e grava em cada item o custo do produto
   * NO MOMENTO da venda, para que o lucro histórico não mude quando o custo mudar.
   */
  async criar(dto: CriarVendaDto, usuarioId: string) {
    const quantidades = agruparItens(dto.itens);
    const ids = [...quantidades.keys()];

    return this.prisma.$transaction(async (tx) => {
      await travarProdutos(tx, ids);
      const produtos = await tx.produto.findMany({ where: { id: { in: ids } } });
      const porId = new Map(produtos.map((p) => [p.id, p]));

      for (const [id, qtd] of quantidades) {
        const p = porId.get(id);
        if (!p) throw new NotFoundException(`Produto ${id} não encontrado`);
        if (!p.ativo) throw new RegraNegocioError(`O produto "${p.nome}" está inativo`);
        calcularBaixa(id, p.estoqueAtual, qtd);
      }

      const itens = dto.itens.map((i) => {
        const p = porId.get(i.produtoId)!;
        return {
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario ?? p.precoVenda,
          custoUnitario: p.precoCusto,
        };
      });
      const totais = calcularTotaisVenda(itens);

      // Baixa condicional: mesmo que o bloqueio falhe, o estoque nunca fica negativo
      for (const [id, qtd] of quantidades) {
        const { count } = await tx.produto.updateMany({
          where: { id, estoqueAtual: { gte: qtd } },
          data: { estoqueAtual: { decrement: qtd } },
        });
        if (count === 0) {
          throw new EstoqueInsuficienteError(id, porId.get(id)!.estoqueAtual, qtd);
        }
      }

      return tx.venda.create({
        data: { usuarioId, ...totais, itens: { create: itens } },
        include: { itens: true },
      });
    });
  }

  /**
   * Cancela a venda: devolve as unidades ao estoque (recalculando o custo médio com o
   * custo gravado em cada item) e marca a venda como CANCELADA, o que a tira dos relatórios.
   * Uma venda só pode ser cancelada uma vez, mesmo com pedidos simultâneos.
   */
  async cancelar(id: string, usuarioId: string, motivo: string) {
    return this.prisma.$transaction(async (tx) => {
      const venda = await tx.venda.findUnique({ where: { id }, include: { itens: true } });
      if (!venda) throw new NotFoundException('Venda não encontrada');

      // Marca primeiro, de forma condicional: só um cancelamento concorrente passa daqui
      const { count } = await tx.venda.updateMany({
        where: { id, status: StatusVenda.CONCLUIDA },
        data: {
          status: StatusVenda.CANCELADA,
          canceladaEm: new Date(),
          canceladaPorId: usuarioId,
          motivoCancelamento: motivo,
        },
      });
      if (count === 0) throw new RegraNegocioError('Esta venda já foi cancelada');

      const ids = venda.itens.map((i) => i.produtoId);
      await travarProdutos(tx, ids);
      const produtos = await tx.produto.findMany({ where: { id: { in: ids } } });
      const porId = new Map(produtos.map((p) => [p.id, { ...p }]));
      for (const item of venda.itens) {
        const p = porId.get(item.produtoId)!;
        p.precoCusto = custoMedioPonderado(p.estoqueAtual, p.precoCusto, item.quantidade, item.custoUnitario);
        p.estoqueAtual += item.quantidade;
      }
      for (const p of porId.values()) {
        await tx.produto.update({ where: { id: p.id }, data: { estoqueAtual: p.estoqueAtual, precoCusto: p.precoCusto } });
      }

      return tx.venda.findUniqueOrThrow({ where: { id }, include: { itens: true } });
    });
  }

  async listar(p: PaginacaoDto) {
    const [dados, total] = await Promise.all([
      this.prisma.venda.findMany({ orderBy: { data: 'desc' }, skip: p.skip, take: p.limite }),
      this.prisma.venda.count(),
    ]);
    return { dados, total, pagina: p.pagina, limite: p.limite };
  }

  async buscar(id: string) {
    const venda = await this.prisma.venda.findUnique({
      where: { id },
      include: { itens: { include: { produto: { select: { id: true, nome: true } } } } },
    });
    if (!venda) throw new NotFoundException('Venda não encontrada');
    return venda;
  }
}
