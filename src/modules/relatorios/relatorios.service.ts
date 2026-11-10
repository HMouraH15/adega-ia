import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StatusVenda } from '@prisma/client';
import { Decimal } from '../../domain/decimal';
import { margemPercentual } from '../../domain/lucro.rules';
import { criarPeriodo, formatarData, Periodo, ultimosDias } from '../../domain/periodo';
import { sugerirReposicao } from '../../domain/reposicao.rules';
import { PrismaService } from '../../prisma/prisma.service';

export type Agrupamento = 'dia' | 'semana' | 'mes';
export type CriterioRanking = 'quantidade' | 'receita' | 'lucro';

const dinheiro = (d: Decimal | null | undefined) => (d ?? new Decimal(0)).toFixed(2);

/**
 * Relatórios somente leitura. Toda resposta informa o período considerado e
 * traz `semDados: true` quando não há movimento — o assistente depende disso.
 */
@Injectable()
export class RelatoriosService {
  private readonly fuso: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.fuso = config.get<string>('FUSO_HORARIO', '-03:00');
  }

  periodo(inicio: string, fim: string): Periodo {
    return criarPeriodo(inicio, fim, this.fuso);
  }

  /** Vendas concluídas no período (canceladas ficam de fora de todos os relatórios). */
  private vendasConcluidas(p: Periodo): Prisma.VendaWhereInput {
    return { status: StatusVenda.CONCLUIDA, data: { gte: p.inicio, lt: p.fimExclusivo } };
  }

  private descreverPeriodo(p: Periodo) {
    return { inicio: p.inicioTexto, fim: p.fimTexto, dias: p.dias };
  }

  async lucro(inicio: string, fim: string) {
    const p = this.periodo(inicio, fim);
    const agg = await this.prisma.venda.aggregate({
      where: this.vendasConcluidas(p),
      _sum: { valorTotal: true, custoTotal: true, lucro: true },
      _count: { _all: true },
    });
    const receita = agg._sum.valorTotal ?? new Decimal(0);
    const lucro = agg._sum.lucro ?? new Decimal(0);
    return {
      periodo: this.descreverPeriodo(p),
      semDados: agg._count._all === 0,
      quantidadeVendas: agg._count._all,
      receita: dinheiro(receita),
      custo: dinheiro(agg._sum.custoTotal),
      lucro: dinheiro(lucro),
      margemPercentual: margemPercentual(receita, lucro)?.toFixed(2) ?? null,
    };
  }

  async vendasPorPeriodo(inicio: string, fim: string, agrupamento: Agrupamento) {
    const p = this.periodo(inicio, fim);
    const vendas = await this.prisma.venda.findMany({
      where: this.vendasConcluidas(p),
      select: { data: true, valorTotal: true, lucro: true },
      orderBy: { data: 'asc' },
    });

    const grupos = new Map<string, { vendas: number; receita: Decimal; lucro: Decimal }>();
    for (const v of vendas) {
      const chave = this.chaveGrupo(v.data, agrupamento);
      const g = grupos.get(chave) ?? { vendas: 0, receita: new Decimal(0), lucro: new Decimal(0) };
      g.vendas += 1;
      g.receita = g.receita.add(v.valorTotal);
      g.lucro = g.lucro.add(v.lucro);
      grupos.set(chave, g);
    }

    return {
      periodo: this.descreverPeriodo(p),
      agrupamento,
      semDados: vendas.length === 0,
      totalVendas: vendas.length,
      series: [...grupos.entries()].map(([grupo, g]) => ({
        grupo,
        vendas: g.vendas,
        receita: dinheiro(g.receita),
        lucro: dinheiro(g.lucro),
      })),
    };
  }

  /** dia → AAAA-MM-DD; semana → segunda-feira da semana; mes → AAAA-MM (no fuso da loja). */
  private chaveGrupo(data: Date, agrupamento: Agrupamento): string {
    const dia = formatarData(data, this.fuso);
    if (agrupamento === 'dia') return dia;
    if (agrupamento === 'mes') return dia.slice(0, 7);
    const d = new Date(`${dia}T00:00:00Z`);
    const deslocamento = (d.getUTCDay() + 6) % 7; // segunda = 0
    d.setUTCDate(d.getUTCDate() - deslocamento);
    return `semana de ${d.toISOString().slice(0, 10)}`;
  }

  async maisVendidos(inicio: string, fim: string, criterio: CriterioRanking, limite: number) {
    const p = this.periodo(inicio, fim);
    const itens = await this.prisma.vendaItem.findMany({
      where: { venda: this.vendasConcluidas(p) },
      select: {
        produtoId: true,
        quantidade: true,
        precoUnitario: true,
        custoUnitario: true,
        produto: { select: { nome: true } },
      },
    });

    const porProduto = new Map<string, { nome: string; quantidade: number; receita: Decimal; lucro: Decimal }>();
    for (const i of itens) {
      const a = porProduto.get(i.produtoId) ?? { nome: i.produto.nome, quantidade: 0, receita: new Decimal(0), lucro: new Decimal(0) };
      const receita = i.precoUnitario.mul(i.quantidade);
      a.quantidade += i.quantidade;
      a.receita = a.receita.add(receita);
      a.lucro = a.lucro.add(receita.sub(i.custoUnitario.mul(i.quantidade)));
      porProduto.set(i.produtoId, a);
    }

    const valor = (a: { quantidade: number; receita: Decimal; lucro: Decimal }) =>
      criterio === 'quantidade' ? new Decimal(a.quantidade) : criterio === 'receita' ? a.receita : a.lucro;

    const ranking = [...porProduto.entries()]
      .sort(([, a], [, b]) => valor(b).comparedTo(valor(a)))
      .slice(0, limite)
      .map(([produtoId, a], idx) => ({
        posicao: idx + 1,
        produtoId,
        nome: a.nome,
        quantidade: a.quantidade,
        receita: dinheiro(a.receita),
        lucro: dinheiro(a.lucro),
      }));

    return { periodo: this.descreverPeriodo(p), criterio, semDados: ranking.length === 0, ranking };
  }

  /**
   * Sugestão de reposição com base na média diária de vendas dos últimos `diasHistorico` dias.
   * Com `apenasNecessarios`, devolve só os produtos que precisam de reposição.
   */
  async sugestaoReposicao(diasHistorico: number, diasCobertura: number, apenasNecessarios = true, limite = 50) {
    const p = ultimosDias(diasHistorico, this.fuso);
    const [produtos, vendidos] = await Promise.all([
      this.prisma.produto.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, estoqueAtual: true, estoqueMinimo: true, precoCusto: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.vendaItem.groupBy({
        by: ['produtoId'],
        where: { venda: this.vendasConcluidas(p) },
        _sum: { quantidade: true },
      }),
    ]);
    const vendidoPorProduto = new Map(vendidos.map((v) => [v.produtoId, v._sum.quantidade ?? 0]));

    const sugestoes = produtos
      .map((prod) => {
        const r = sugerirReposicao({
          estoqueAtual: prod.estoqueAtual,
          estoqueMinimo: prod.estoqueMinimo,
          vendidoNoPeriodo: vendidoPorProduto.get(prod.id) ?? 0,
          diasHistorico,
          diasCobertura,
        });
        return {
          produtoId: prod.id,
          nome: prod.nome,
          estoqueAtual: prod.estoqueAtual,
          estoqueMinimo: prod.estoqueMinimo,
          vendidoNoPeriodo: vendidoPorProduto.get(prod.id) ?? 0,
          ...r,
          custoEstimado: prod.precoCusto.mul(r.quantidadeSugerida).toFixed(2),
        };
      })
      .filter((s) => !apenasNecessarios || s.precisaRepor)
      .sort((a, b) => (a.diasRestantes ?? Infinity) - (b.diasRestantes ?? Infinity))
      .slice(0, limite);

    return {
      periodoHistorico: this.descreverPeriodo(p),
      diasCobertura,
      semVendasNoPeriodo: vendidos.length === 0,
      semDados: sugestoes.length === 0,
      sugestoes,
    };
  }
}
