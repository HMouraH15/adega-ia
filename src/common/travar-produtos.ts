import { Prisma } from '@prisma/client';

/**
 * Bloqueia as linhas dos produtos (SELECT … FOR UPDATE) até o fim da transação,
 * em ordem de id para evitar deadlock entre transações concorrentes.
 * Assim duas vendas/compras simultâneas do mesmo produto são serializadas.
 */
export async function travarProdutos(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const ordenados = [...new Set(ids)].sort();
  if (!ordenados.length) return;
  await tx.$queryRaw`SELECT id FROM "Produto" WHERE id IN (${Prisma.join(ordenados)}) ORDER BY id FOR UPDATE`;
}
