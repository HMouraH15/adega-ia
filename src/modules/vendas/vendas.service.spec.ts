import { Prisma } from '@prisma/client';
import { EstoqueInsuficienteError, RegraNegocioError } from '../../domain/errors';
import { VendasService } from './vendas.service';

const D = (v: string | number) => new Prisma.Decimal(v);

function produto(over: Partial<Record<string, unknown>> = {}) {
  return { id: 'p1', nome: 'Malbec', ativo: true, estoqueAtual: 10, precoCusto: D('30.0000'), precoVenda: D('50.00'), ...over };
}

function criarMocks(produtos: ReturnType<typeof produto>[], updateCount = 1) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    produto: {
      findMany: jest.fn().mockResolvedValue(produtos),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
    },
    venda: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'v1', ...data })) },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, service: new VendasService(prisma as any) };
}

describe('VendasService.criar', () => {
  it('grava o custo do produto no momento da venda e calcula o lucro', async () => {
    const { tx, service } = criarMocks([produto()]);
    await service.criar({ itens: [{ produtoId: 'p1', quantidade: 2 }] }, 'u1');

    const data = tx.venda.create.mock.calls[0][0].data;
    expect(data.itens.create[0].custoUnitario.toString()).toBe('30');
    expect(data.itens.create[0].precoUnitario.toString()).toBe('50');
    expect(data.valorTotal.toFixed(2)).toBe('100.00');
    expect(data.custoTotal.toFixed(2)).toBe('60.00');
    expect(data.lucro.toFixed(2)).toBe('40.00');
  });

  it('o lucro de uma venda antiga não muda quando o custo do produto muda depois', async () => {
    const p = produto();
    const { tx, service } = criarMocks([p]);
    await service.criar({ itens: [{ produtoId: 'p1', quantidade: 1 }] }, 'u1');
    const itemGravado = tx.venda.create.mock.calls[0][0].data.itens.create[0];

    p.precoCusto = D('45'); // compra posterior encarece o produto
    expect(itemGravado.custoUnitario.toString()).toBe('30');
  });

  it('usa o preço informado (desconto) em vez do preço de tabela', async () => {
    const { tx, service } = criarMocks([produto()]);
    await service.criar({ itens: [{ produtoId: 'p1', quantidade: 1, precoUnitario: 45 }] }, 'u1');
    expect(tx.venda.create.mock.calls[0][0].data.lucro.toFixed(2)).toBe('15.00');
  });

  it('baixa o estoque com decremento condicional (nunca negativo)', async () => {
    const { tx, service } = criarMocks([produto()]);
    await service.criar({ itens: [{ produtoId: 'p1', quantidade: 3 }] }, 'u1');
    expect(tx.produto.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', estoqueAtual: { gte: 3 } },
      data: { estoqueAtual: { decrement: 3 } },
    });
    expect(tx.$queryRaw).toHaveBeenCalled(); // linhas bloqueadas antes de ler
  });

  it('rejeita venda acima do estoque sem gravar nada', async () => {
    const { tx, service } = criarMocks([produto({ estoqueAtual: 2 })]);
    await expect(service.criar({ itens: [{ produtoId: 'p1', quantidade: 3 }] }, 'u1')).rejects.toBeInstanceOf(
      EstoqueInsuficienteError,
    );
    expect(tx.produto.updateMany).not.toHaveBeenCalled();
    expect(tx.venda.create).not.toHaveBeenCalled();
  });

  it('soma itens repetidos do mesmo produto antes de checar o estoque', async () => {
    const { tx, service } = criarMocks([produto({ estoqueAtual: 5 })]);
    await expect(
      service.criar(
        {
          itens: [
            { produtoId: 'p1', quantidade: 3 },
            { produtoId: 'p1', quantidade: 3 },
          ],
        },
        'u1',
      ),
    ).rejects.toBeInstanceOf(EstoqueInsuficienteError);
    expect(tx.venda.create).not.toHaveBeenCalled();
  });

  it('falha se o decremento condicional não afetar linhas (venda concorrente)', async () => {
    const { tx, service } = criarMocks([produto()], 0);
    await expect(service.criar({ itens: [{ produtoId: 'p1', quantidade: 1 }] }, 'u1')).rejects.toBeInstanceOf(
      EstoqueInsuficienteError,
    );
    expect(tx.venda.create).not.toHaveBeenCalled();
  });

  it('rejeita produto inativo', async () => {
    const { service } = criarMocks([produto({ ativo: false })]);
    await expect(service.criar({ itens: [{ produtoId: 'p1', quantidade: 1 }] }, 'u1')).rejects.toBeInstanceOf(
      RegraNegocioError,
    );
  });
});

describe('VendasService.cancelar', () => {
  function mocks(opcoes: { venda?: object | null; cancelou?: number; produto?: object } = {}) {
    const venda =
      opcoes.venda === undefined
        ? { id: 'v1', status: 'CONCLUIDA', itens: [{ produtoId: 'p1', quantidade: 2, custoUnitario: D(30) }] }
        : opcoes.venda;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      venda: {
        findUnique: jest.fn().mockResolvedValue(venda),
        updateMany: jest.fn().mockResolvedValue({ count: opcoes.cancelou ?? 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'v1', status: 'CANCELADA' }),
      },
      produto: {
        findMany: jest.fn().mockResolvedValue([opcoes.produto ?? produto({ estoqueAtual: 8, precoCusto: D(40) })]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { tx, service: new VendasService(prisma as any) };
  }

  it('devolve o estoque e recalcula o custo médio com o custo gravado na venda', async () => {
    const { tx, service } = mocks();
    await service.cancelar('v1', 'admin', 'cliente desistiu');

    expect(tx.venda.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', status: 'CONCLUIDA' },
      data: expect.objectContaining({ status: 'CANCELADA', canceladaPorId: 'admin', motivoCancelamento: 'cliente desistiu' }),
    });
    const { data } = tx.produto.update.mock.calls[0][0];
    expect(data.estoqueAtual).toBe(10);
    // (8 × 40 + 2 × 30) / 10 = 38
    expect(data.precoCusto.toString()).toBe('38');
  });

  it('não cancela duas vezes nem mexe no estoque', async () => {
    const { tx, service } = mocks({ cancelou: 0 });
    await expect(service.cancelar('v1', 'admin', 'motivo')).rejects.toBeInstanceOf(RegraNegocioError);
    expect(tx.produto.update).not.toHaveBeenCalled();
  });

  it('venda inexistente → 404', async () => {
    const { service } = mocks({ venda: null });
    await expect(service.cancelar('x', 'admin', 'motivo')).rejects.toMatchObject({ status: 404 });
  });
});
