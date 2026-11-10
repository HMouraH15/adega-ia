import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RegraNegocioError } from '../../domain/errors';
import { ComprasService } from './compras.service';

const D = (v: string | number) => new Prisma.Decimal(v);

function criarMocks(produtos: object[], fornecedor: object | null = { id: 'f1', nome: 'Distribuidora' }) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    fornecedor: { findUnique: jest.fn().mockResolvedValue(fornecedor) },
    produto: {
      findMany: jest.fn().mockResolvedValue(produtos),
      update: jest.fn().mockResolvedValue({}),
    },
    compra: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })) },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, service: new ComprasService(prisma as any) };
}

const malbec = () => ({ id: 'p1', nome: 'Malbec', ativo: true, estoqueAtual: 10, precoCusto: D(20) });

describe('ComprasService.criar', () => {
  it('aumenta o estoque e recalcula o custo médio ponderado', async () => {
    const { tx, service } = criarMocks([malbec()]);
    await service.criar({ fornecedorId: 'f1', itens: [{ produtoId: 'p1', quantidade: 30, custoUnitario: 24 }] }, 'u1');

    const { data } = tx.produto.update.mock.calls[0][0];
    expect(data.estoqueAtual).toBe(40);
    expect(data.precoCusto.toString()).toBe('23'); // (10×20 + 30×24) / 40
    expect(tx.compra.create.mock.calls[0][0].data.valorTotal.toFixed(2)).toBe('720.00');
  });

  it('aplica itens repetidos em sequência (estoque e custo acumulados)', async () => {
    const { tx, service } = criarMocks([{ ...malbec(), estoqueAtual: 0, precoCusto: D(0) }]);
    await service.criar(
      {
        fornecedorId: 'f1',
        itens: [
          { produtoId: 'p1', quantidade: 10, custoUnitario: 10 },
          { produtoId: 'p1', quantidade: 10, custoUnitario: 20 },
        ],
      },
      'u1',
    );
    expect(tx.produto.update).toHaveBeenCalledTimes(1);
    const { data } = tx.produto.update.mock.calls[0][0];
    expect(data.estoqueAtual).toBe(20);
    expect(data.precoCusto.toString()).toBe('15');
  });

  it('rejeita fornecedor inexistente', async () => {
    const { tx, service } = criarMocks([malbec()], null);
    await expect(
      service.criar({ fornecedorId: 'x', itens: [{ produtoId: 'p1', quantidade: 1, custoUnitario: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.produto.update).not.toHaveBeenCalled();
  });

  it('rejeita produto inativo ou inexistente', async () => {
    const inativo = criarMocks([{ ...malbec(), ativo: false }]);
    await expect(
      inativo.service.criar({ fornecedorId: 'f1', itens: [{ produtoId: 'p1', quantidade: 1, custoUnitario: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(RegraNegocioError);

    const inexistente = criarMocks([]);
    await expect(
      inexistente.service.criar({ fornecedorId: 'f1', itens: [{ produtoId: 'p1', quantidade: 1, custoUnitario: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejeita quantidade inválida antes de abrir a transação', async () => {
    const { tx, service } = criarMocks([malbec()]);
    await expect(
      service.criar({ fornecedorId: 'f1', itens: [{ produtoId: 'p1', quantidade: 0, custoUnitario: 1 }] }, 'u1'),
    ).rejects.toBeInstanceOf(RegraNegocioError);
    expect(tx.fornecedor.findUnique).not.toHaveBeenCalled();
  });
});
