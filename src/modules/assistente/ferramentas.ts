import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Decimal } from '../../domain/decimal';
import { RegraNegocioError } from '../../domain/errors';
import { FornecedoresService } from '../fornecedores/fornecedores';
import { ProdutosService } from '../produtos/produtos.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { FerramentaLlm } from './llm/llm.types';
import { protegerDadosPessoais } from './privacidade';

/** Ação que a IA propõe e que só acontece se o usuário clicar em confirmar. */
export interface AcaoSugerida {
  id: string;
  tipo: 'REGISTRAR_COMPRA' | 'AJUSTAR_PRECO';
  descricao: string;
  /** Requisição que o front-end envia (com o JWT do usuário) quando ele confirma */
  requisicao: { metodo: 'POST' | 'PATCH'; caminho: string; corpo: Record<string, unknown> };
  /** Campos que o usuário ainda precisa preencher antes de confirmar */
  camposPendentes: string[];
}

export interface ResultadoFerramenta {
  conteudo: string;
  erro: boolean;
  acao?: AcaoSugerida;
}

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const PERIODO_PROPS = {
  inicio: { type: 'string', description: 'Data inicial AAAA-MM-DD (inclusiva)' },
  fim: { type: 'string', description: 'Data final AAAA-MM-DD (inclusiva)' },
} as const;

const schemas = {
  buscar_produtos: z.object({
    termo: z.string().max(120).nullish(),
    categoria: z.string().max(60).nullish(),
  }),
  estoque_baixo: z.object({}),
  relatorio_lucro: z.object({ inicio: DATA, fim: DATA }),
  vendas_por_periodo: z.object({
    inicio: DATA,
    fim: DATA,
    agrupamento: z.enum(['dia', 'semana', 'mes']).nullish(),
  }),
  produtos_mais_vendidos: z.object({
    inicio: DATA,
    fim: DATA,
    criterio: z.enum(['quantidade', 'receita', 'lucro']).nullish(),
    limite: z.number().int().min(1).max(20).nullish(),
  }),
  sugerir_reposicao: z.object({
    dias_historico: z.number().int().min(7).max(180).nullish(),
    dias_cobertura: z.number().int().min(1).max(90).nullish(),
  }),
  sugerir_preco: z.object({
    produto_id: z.uuid(),
    margem_desejada_percentual: z.number().gt(0).lt(100),
  }),
  propor_compra: z.object({
    fornecedor_id: z.uuid().nullish(),
    itens: z
      .array(
        z.object({
          produto_id: z.uuid(),
          quantidade: z.number().int().min(1).max(100_000),
          custo_unitario: z.number().min(0).nullish(),
        }),
      )
      .min(1)
      .max(50),
    justificativa: z.string().max(500),
  }),
  propor_ajuste_preco: z.object({
    produto_id: z.uuid(),
    novo_preco_venda: z.number().gt(0),
    justificativa: z.string().max(500),
  }),
};

export type NomeFerramenta = keyof typeof schemas;

/**
 * Definições enviadas à API. Descrições curtas de propósito: elas entram em
 * toda requisição (cacheadas, mas ainda contam no primeiro envio).
 * A ordem é fixa para não invalidar o cache de prompt.
 */
export const DEFINICOES_FERRAMENTAS: FerramentaLlm[] = [
  {
    nome: 'buscar_produtos',
    descricao: 'Busca produtos ativos por parte do nome e/ou categoria. Retorna id, preços, margem e estoque (máx. 20).',
    parametros: {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'Parte do nome do produto' },
        categoria: { type: 'string', description: 'Parte do nome da categoria' },
      },
    },
  },
  {
    nome: 'estoque_baixo',
    descricao: 'Lista produtos ativos com estoque atual menor ou igual ao estoque mínimo.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nome: 'relatorio_lucro',
    descricao: 'Receita, custo, lucro, margem e número de vendas no período.',
    parametros: { type: 'object', properties: PERIODO_PROPS, required: ['inicio', 'fim'] },
  },
  {
    nome: 'vendas_por_periodo',
    descricao: 'Vendas agrupadas por dia, semana ou mês no período (quantidade, receita, lucro).',
    parametros: {
      type: 'object',
      properties: { ...PERIODO_PROPS, agrupamento: { type: 'string', enum: ['dia', 'semana', 'mes'] } },
      required: ['inicio', 'fim'],
    },
  },
  {
    nome: 'produtos_mais_vendidos',
    descricao: 'Ranking de produtos no período por quantidade, receita ou lucro.',
    parametros: {
      type: 'object',
      properties: {
        ...PERIODO_PROPS,
        criterio: { type: 'string', enum: ['quantidade', 'receita', 'lucro'] },
        limite: { type: 'integer', description: '1 a 20; padrão 10' },
      },
      required: ['inicio', 'fim'],
    },
  },
  {
    nome: 'sugerir_reposicao',
    descricao:
      'Sugere quanto comprar de cada produto com base na média de vendas diárias. Retorna só os que precisam de reposição.',
    parametros: {
      type: 'object',
      properties: {
        dias_historico: { type: 'integer', description: 'Dias de histórico para a média (7 a 180; padrão 30)' },
        dias_cobertura: { type: 'integer', description: 'Dias de venda que a compra deve cobrir (1 a 90; padrão 15)' },
      },
    },
  },
  {
    nome: 'sugerir_preco',
    descricao: 'Calcula o preço de venda para atingir a margem desejada (sobre o preço) a partir do custo atual do produto.',
    parametros: {
      type: 'object',
      properties: {
        produto_id: { type: 'string', description: 'id do produto (obtenha com buscar_produtos)' },
        margem_desejada_percentual: { type: 'number', description: 'Ex.: 35 para 35%' },
      },
      required: ['produto_id', 'margem_desejada_percentual'],
    },
  },
  {
    nome: 'propor_compra',
    descricao:
      'Propõe registrar uma compra. NÃO grava nada: o usuário verá um botão para confirmar. Use ids obtidos pelas outras ferramentas.',
    parametros: {
      type: 'object',
      properties: {
        fornecedor_id: { type: 'string', description: 'Opcional; se omitido o usuário escolhe ao confirmar' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              produto_id: { type: 'string' },
              quantidade: { type: 'integer' },
              custo_unitario: { type: 'number', description: 'Opcional; padrão = custo atual do produto' },
            },
            required: ['produto_id', 'quantidade'],
          },
        },
        justificativa: { type: 'string' },
      },
      required: ['itens', 'justificativa'],
    },
  },
  {
    nome: 'propor_ajuste_preco',
    descricao: 'Propõe alterar o preço de venda de um produto. NÃO grava nada: o usuário verá um botão para confirmar.',
    parametros: {
      type: 'object',
      properties: {
        produto_id: { type: 'string' },
        novo_preco_venda: { type: 'number' },
        justificativa: { type: 'string' },
      },
      required: ['produto_id', 'novo_preco_venda', 'justificativa'],
    },
  },
];

const dinheiro = (d: Decimal) => d.toFixed(2);

/**
 * Executa as ferramentas do assistente. Todas são SOMENTE LEITURA: usam apenas
 * métodos de consulta dos services. As "propor_*" só montam uma AcaoSugerida;
 * quem grava é o endpoint normal, chamado pelo usuário ao confirmar.
 */
@Injectable()
export class FerramentasAssistente {
  private readonly logger = new Logger(FerramentasAssistente.name);

  constructor(
    private readonly produtos: ProdutosService,
    private readonly relatorios: RelatoriosService,
    private readonly fornecedores: FornecedoresService,
  ) {}

  async executar(nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
    if (!(nome in schemas)) return this.falha(`Ferramenta desconhecida: ${nome}`);
    const parse = schemas[nome as NomeFerramenta].safeParse(entrada ?? {});
    if (!parse.success) {
      const detalhes = parse.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
      return this.falha(`Parâmetros inválidos. ${detalhes}`);
    }
    try {
      const { dados, acao } = await this.despachar(nome as NomeFerramenta, parse.data);
      // Nada sai para o modelo sem passar pelo filtro de privacidade (lista de campos permitidos)
      return { conteudo: JSON.stringify(protegerDadosPessoais(dados)), erro: false, acao };
    } catch (e) {
      if (e instanceof RegraNegocioError || e instanceof HttpException) return this.falha(e.message);
      this.logger.error(`Falha na ferramenta ${nome}: ${e instanceof Error ? e.stack : String(e)}`);
      return this.falha('Falha ao consultar os dados. Informe ao usuário que não foi possível obter essa informação agora.');
    }
  }

  private falha(mensagem: string): ResultadoFerramenta {
    return { conteudo: mensagem, erro: true };
  }

  private async despachar(nome: NomeFerramenta, e: any): Promise<{ dados: unknown; acao?: AcaoSugerida }> {
    switch (nome) {
      case 'buscar_produtos': {
        const lista = await this.produtos.pesquisar(e.termo ?? null, e.categoria ?? null, 20);
        return { dados: { semDados: lista.length === 0, produtos: lista.map((p) => this.resumoProduto(p)) } };
      }
      case 'estoque_baixo': {
        const lista = await this.produtos.estoqueBaixo(50);
        return { dados: { semDados: lista.length === 0, produtos: lista.map((p) => this.resumoProduto(p)) } };
      }
      case 'relatorio_lucro':
        return { dados: await this.relatorios.lucro(e.inicio, e.fim) };
      case 'vendas_por_periodo':
        return { dados: await this.relatorios.vendasPorPeriodo(e.inicio, e.fim, e.agrupamento ?? 'dia') };
      case 'produtos_mais_vendidos':
        return {
          dados: await this.relatorios.maisVendidos(e.inicio, e.fim, e.criterio ?? 'quantidade', e.limite ?? 10),
        };
      case 'sugerir_reposicao':
        return {
          dados: await this.relatorios.sugestaoReposicao(e.dias_historico ?? 30, e.dias_cobertura ?? 15, true, 30),
        };
      case 'sugerir_preco':
        return { dados: await this.produtos.sugestaoPreco(e.produto_id, e.margem_desejada_percentual) };
      case 'propor_compra':
        return this.proporCompra(e);
      case 'propor_ajuste_preco':
        return this.proporAjustePreco(e);
    }
  }

  private resumoProduto(p: {
    id: string;
    nome: string;
    categoria: { nome: string };
    precoCusto: Decimal;
    precoVenda: Decimal;
    estoqueAtual: number;
    estoqueMinimo: number;
  }) {
    const margem = p.precoVenda.isZero()
      ? null
      : p.precoVenda.sub(p.precoCusto).div(p.precoVenda).mul(100).toFixed(1);
    return {
      id: p.id,
      nome: p.nome,
      categoria: p.categoria.nome,
      custo: dinheiro(p.precoCusto),
      venda: dinheiro(p.precoVenda),
      margemPct: margem,
      estoque: p.estoqueAtual,
      minimo: p.estoqueMinimo,
    };
  }

  private async proporCompra(e: z.infer<typeof schemas.propor_compra>) {
    const ids = [...new Set(e.itens.map((i) => i.produto_id))];
    const produtos = await this.produtos.buscarVarios(ids);
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const faltando = ids.filter((id) => !porId.get(id)?.ativo);
    if (faltando.length) throw new RegraNegocioError(`Produtos inexistentes ou inativos: ${faltando.join(', ')}`);

    let fornecedorNome: string | null = null;
    if (e.fornecedor_id) fornecedorNome = (await this.fornecedores.buscar(e.fornecedor_id)).nome;

    const itens = e.itens.map((i) => ({
      produtoId: i.produto_id,
      quantidade: i.quantidade,
      custoUnitario: Number((i.custo_unitario ?? porId.get(i.produto_id)!.precoCusto.toNumber()).toFixed(4)),
    }));
    const total = itens.reduce((s, i) => s.add(new Decimal(i.custoUnitario).mul(i.quantidade)), new Decimal(0));
    const resumo = itens.map((i) => `${i.quantidade}× ${porId.get(i.produtoId)!.nome}`).join(', ');

    const acao: AcaoSugerida = {
      id: randomUUID(),
      tipo: 'REGISTRAR_COMPRA',
      descricao: `Registrar compra${fornecedorNome ? ` de ${fornecedorNome}` : ''}: ${resumo} (total R$ ${dinheiro(total)}). ${e.justificativa}`,
      requisicao: {
        metodo: 'POST',
        caminho: '/api/compras',
        corpo: { fornecedorId: e.fornecedor_id ?? null, itens },
      },
      camposPendentes: e.fornecedor_id ? [] : ['fornecedorId'],
    };
    return {
      dados: {
        status: 'aguardando_confirmacao_do_usuario',
        acaoId: acao.id,
        totalEstimado: dinheiro(total),
        fornecedorPendente: !e.fornecedor_id,
        observacao: 'Nada foi registrado. O usuário verá um botão para confirmar.',
      },
      acao,
    };
  }

  private async proporAjustePreco(e: z.infer<typeof schemas.propor_ajuste_preco>) {
    const p = await this.produtos.buscar(e.produto_id);
    if (!p.ativo) throw new RegraNegocioError('Produto inativo');
    const novo = new Decimal(e.novo_preco_venda).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const margemNova = novo.sub(p.precoCusto).div(novo).mul(100).toFixed(1);
    const acao: AcaoSugerida = {
      id: randomUUID(),
      tipo: 'AJUSTAR_PRECO',
      descricao: `Alterar preço de "${p.nome}" de R$ ${dinheiro(p.precoVenda)} para R$ ${dinheiro(novo)} (margem ${margemNova}%). ${e.justificativa}`,
      requisicao: { metodo: 'PATCH', caminho: `/api/produtos/${p.id}`, corpo: { precoVenda: novo.toNumber() } },
      camposPendentes: [],
    };
    return {
      dados: {
        status: 'aguardando_confirmacao_do_usuario',
        acaoId: acao.id,
        precoAtual: dinheiro(p.precoVenda),
        precoProposto: dinheiro(novo),
        margemResultantePct: margemNova,
        observacao: 'Nada foi alterado. O usuário verá um botão para confirmar.',
      },
      acao,
    };
  }

}
