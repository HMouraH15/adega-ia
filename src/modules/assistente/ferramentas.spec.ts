import { Prisma } from '@prisma/client';
import { FornecedoresService } from '../fornecedores/fornecedores';
import { ProdutosService } from '../produtos/produtos.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { DEFINICOES_FERRAMENTAS, FerramentasAssistente } from './ferramentas';
import { CAMPOS_PERMITIDOS } from './privacidade';

const D = (v: number) => new Prisma.Decimal(v);
const PRODUTO_ID = '11111111-1111-4111-8111-111111111111';
const FORNECEDOR_ID = '22222222-2222-4222-8222-222222222222';

const produtoRow = {
  id: PRODUTO_ID,
  nome: 'Malbec 750ml',
  ativo: true,
  categoria: { id: 'c1', nome: 'Vinhos' },
  precoCusto: D(30),
  precoVenda: D(50),
  estoqueAtual: 3,
  estoqueMinimo: 6,
};

const ESCRITA = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;

/**
 * Prisma falso: responde às leituras com dados prontos e REGISTRA qualquer
 * tentativa de escrita. Usado para provar que as ferramentas são só leitura.
 */
function prismaSomenteLeitura(vazio = false, produto: object = produtoRow) {
  const escritas: string[] = [];
  const leituras: Record<string, Record<string, unknown>> = {
    produto: {
      findMany: vazio ? [] : [produto],
      findUnique: produto,
      fields: { estoqueMinimo: 'estoqueMinimo' },
    },
    venda: {
      aggregate: vazio
        ? { _sum: { valorTotal: null, custoTotal: null, lucro: null }, _count: { _all: 0 } }
        : { _sum: { valorTotal: D(100), custoTotal: D(60), lucro: D(40) }, _count: { _all: 2 } },
      findMany: vazio ? [] : [{ data: new Date('2026-11-05T15:00:00Z'), valorTotal: D(100), lucro: D(40) }],
    },
    vendaItem: {
      findMany: vazio
        ? []
        : [{ produtoId: PRODUTO_ID, quantidade: 2, precoUnitario: D(50), custoUnitario: D(30), produto: { nome: 'Malbec 750ml' } }],
      groupBy: vazio ? [] : [{ produtoId: PRODUTO_ID, _sum: { quantidade: 60 } }],
    },
    fornecedor: { findUniqueOrThrow: { id: FORNECEDOR_ID, nome: 'Distribuidora Sul' } },
  };

  const modelo = (nome: string) =>
    new Proxy(
      {},
      {
        get(_, metodo: string) {
          if (metodo === 'fields') return leituras[nome]?.fields;
          return (..._args: unknown[]) => {
            if (ESCRITA.test(metodo)) {
              escritas.push(`${nome}.${metodo}`);
              return Promise.reject(new Error('escrita proibida'));
            }
            return Promise.resolve(leituras[nome]?.[metodo] ?? null);
          };
        },
      },
    );

  const prisma = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop.startsWith('$')) {
          return () => {
            escritas.push(prop);
            return Promise.reject(new Error('operação proibida'));
          };
        }
        return modelo(prop);
      },
    },
  );
  return { prisma: prisma as any, escritas };
}

function montar(vazio = false, produto: object = produtoRow) {
  const { prisma, escritas } = prismaSomenteLeitura(vazio, produto);
  const config = { get: (_: string, padrao?: unknown) => padrao } as any;
  const ferramentas = new FerramentasAssistente(
    new ProdutosService(prisma),
    new RelatoriosService(prisma, config),
    new FornecedoresService(prisma),
  );
  return { ferramentas, escritas };
}

const ENTRADAS: Record<string, unknown> = {
  buscar_produtos: { termo: 'malbec' },
  estoque_baixo: {},
  relatorio_lucro: { inicio: '2026-11-01', fim: '2026-11-10' },
  vendas_por_periodo: { inicio: '2026-11-01', fim: '2026-11-10', agrupamento: 'semana' },
  produtos_mais_vendidos: { inicio: '2026-11-01', fim: '2026-11-10', criterio: 'lucro', limite: 5 },
  sugerir_reposicao: { dias_historico: 30, dias_cobertura: 15 },
  sugerir_preco: { produto_id: PRODUTO_ID, margem_desejada_percentual: 40 },
  propor_compra: { itens: [{ produto_id: PRODUTO_ID, quantidade: 12 }], justificativa: 'Estoque abaixo do mínimo' },
  propor_ajuste_preco: { produto_id: PRODUTO_ID, novo_preco_venda: 55, justificativa: 'Margem baixa' },
};

describe('FerramentasAssistente', () => {
  it('toda ferramenta declarada tem uma entrada de teste (nenhuma fica sem cobertura)', () => {
    expect(DEFINICOES_FERRAMENTAS.map((d) => d.nome).sort()).toEqual(Object.keys(ENTRADAS).sort());
  });

  it.each(Object.entries(ENTRADAS))('%s executa sem nenhuma escrita no banco', async (nome, entrada) => {
    const { ferramentas, escritas } = montar();
    const r = await ferramentas.executar(nome, entrada);
    expect(r.erro).toBe(false);
    expect(() => JSON.parse(r.conteudo)).not.toThrow();
    expect(escritas).toEqual([]);
  });

  it('relatorio_lucro informa o período e os números vindos do banco', async () => {
    const { ferramentas } = montar();
    const r = JSON.parse((await ferramentas.executar('relatorio_lucro', ENTRADAS.relatorio_lucro)).conteudo);
    expect(r).toMatchObject({
      periodo: { inicio: '2026-11-01', fim: '2026-11-10', dias: 10 },
      semDados: false,
      receita: '100.00',
      custo: '60.00',
      lucro: '40.00',
      margemPercentual: '40.00',
    });
  });

  it('sinaliza semDados quando não há movimento no período', async () => {
    const { ferramentas } = montar(true);
    for (const nome of ['relatorio_lucro', 'vendas_por_periodo', 'produtos_mais_vendidos', 'buscar_produtos']) {
      const r = JSON.parse((await ferramentas.executar(nome, ENTRADAS[nome])).conteudo);
      expect(r.semDados).toBe(true);
    }
  });

  it('sugerir_reposicao usa a média diária de vendas', async () => {
    const { ferramentas } = montar();
    const r = JSON.parse((await ferramentas.executar('sugerir_reposicao', ENTRADAS.sugerir_reposicao)).conteudo);
    // 60 vendidos em 30 dias = 2/dia; alvo 2×15 + 6 = 36; estoque 3 → 33
    expect(r.sugestoes[0]).toMatchObject({ mediaDiaria: 2, quantidadeSugerida: 33, custoEstimado: '990.00' });
    expect(r.periodoHistorico.dias).toBe(30);
  });

  it('propor_compra devolve uma ação para confirmação e não grava nada', async () => {
    const { ferramentas, escritas } = montar();
    const r = await ferramentas.executar('propor_compra', ENTRADAS.propor_compra);
    expect(escritas).toEqual([]);
    expect(r.acao).toMatchObject({
      tipo: 'REGISTRAR_COMPRA',
      requisicao: {
        metodo: 'POST',
        caminho: '/api/compras',
        corpo: { fornecedorId: null, itens: [{ produtoId: PRODUTO_ID, quantidade: 12, custoUnitario: 30 }] },
      },
      camposPendentes: ['fornecedorId'],
    });
    expect(JSON.parse(r.conteudo).status).toBe('aguardando_confirmacao_do_usuario');
  });

  it('propor_compra com fornecedor não deixa campos pendentes', async () => {
    const { ferramentas } = montar();
    const r = await ferramentas.executar('propor_compra', { ...(ENTRADAS.propor_compra as object), fornecedor_id: FORNECEDOR_ID });
    expect(r.acao!.camposPendentes).toEqual([]);
    expect(r.acao!.descricao).toContain('Distribuidora Sul');
  });

  it('propor_ajuste_preco monta um PATCH no produto', async () => {
    const { ferramentas } = montar();
    const r = await ferramentas.executar('propor_ajuste_preco', ENTRADAS.propor_ajuste_preco);
    expect(r.acao!.requisicao).toEqual({ metodo: 'PATCH', caminho: `/api/produtos/${PRODUTO_ID}`, corpo: { precoVenda: 55 } });
  });

  it('devolve erro (para o modelo corrigir) quando os parâmetros são inválidos', async () => {
    const { ferramentas } = montar();
    const r = await ferramentas.executar('relatorio_lucro', { inicio: '01/11/2026', fim: '2026-11-10' });
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain('inicio');
  });

  it('devolve erro de regra de negócio como resultado da ferramenta, sem lançar', async () => {
    const { ferramentas } = montar();
    const r = await ferramentas.executar('relatorio_lucro', { inicio: '2026-11-10', fim: '2026-11-01' });
    expect(r.erro).toBe(true);
    expect(r.conteudo).toMatch(/data final/i);
  });

  it('recusa ferramenta desconhecida', async () => {
    const { ferramentas } = montar();
    const r = await ferramentas.executar('registrar_venda', {});
    expect(r).toEqual({ conteudo: 'Ferramenta desconhecida: registrar_venda', erro: true });
  });

  describe('privacidade: nada pessoal vai para o modelo', () => {
    function chaves(v: unknown, acc = new Set<string>()): Set<string> {
      if (Array.isArray(v)) v.forEach((x) => chaves(x, acc));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          acc.add(k);
          chaves(x, acc);
        }
      }
      return acc;
    }

    it.each(Object.entries(ENTRADAS))('%s só devolve campos da lista permitida', async (nome, entrada) => {
      const { ferramentas } = montar();
      const r = await ferramentas.executar(nome, entrada);
      for (const k of chaves(JSON.parse(r.conteudo))) expect(CAMPOS_PERMITIDOS.has(k)).toBe(true);
    });

    it('propor_compra não envia ao modelo o nome do fornecedor nem dados de contato', async () => {
      const { ferramentas } = montar();
      const r = await ferramentas.executar('propor_compra', { ...(ENTRADAS.propor_compra as object), fornecedor_id: FORNECEDOR_ID });
      expect(r.conteudo).not.toContain('Distribuidora Sul');
      // o nome aparece só na descrição do botão, que vai para o usuário e não para o modelo
      expect(r.acao!.descricao).toContain('Distribuidora Sul');
    });

    it('e-mail/telefone digitados no nome de um produto são mascarados', async () => {
      const { ferramentas } = montar(false, { ...produtoRow, nome: 'Gin reservado p/ ana@gmail.com (11) 98765-4321' });
      const r = await ferramentas.executar('buscar_produtos', { termo: 'gin' });
      expect(r.conteudo).not.toMatch(/ana@gmail|98765/);
      expect(JSON.parse(r.conteudo).produtos[0].nome).toBe('Gin reservado p/ [removido] [removido]');
    });
  });
});
