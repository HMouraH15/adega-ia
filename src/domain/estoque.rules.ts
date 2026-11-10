import { Decimal, ValorDecimal } from './decimal';
import { EstoqueInsuficienteError, RegraNegocioError } from './errors';


export interface ItemQuantidade {
  produtoId: string;
  quantidade: number;
}

/** Valida quantidade: inteiro positivo. */
export function validarQuantidade(quantidade: number): void {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new RegraNegocioError('A quantidade deve ser um inteiro maior que zero');
  }
}

/**
 * Soma itens repetidos do mesmo produto. Evita que duas linhas do mesmo produto
 * passem individualmente na checagem de estoque mas juntas o ultrapassem.
 */
export function agruparItens<T extends ItemQuantidade>(itens: T[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    validarQuantidade(item.quantidade);
    mapa.set(item.produtoId, (mapa.get(item.produtoId) ?? 0) + item.quantidade);
  }
  return mapa;
}

/** Garante que a baixa não deixa o estoque negativo. Retorna o novo estoque. */
export function calcularBaixa(produtoId: string, estoqueAtual: number, quantidade: number): number {
  validarQuantidade(quantidade);
  if (quantidade > estoqueAtual) {
    throw new EstoqueInsuficienteError(produtoId, estoqueAtual, quantidade);
  }
  return estoqueAtual - quantidade;
}

/**
 * Custo médio ponderado após uma entrada:
 * (estoque × custoAtual + qtd × custoEntrada) / (estoque + qtd)
 * Estoque negativo ou zero é tratado como zero (o custo passa a ser o da entrada).
 */
export function custoMedioPonderado(
  estoqueAtual: number,
  custoAtual: ValorDecimal,
  quantidadeEntrada: number,
  custoEntrada: ValorDecimal,
): Decimal {
  validarQuantidade(quantidadeEntrada);
  const custoNovo = new Decimal(custoEntrada);
  if (custoNovo.isNegative()) {
    throw new RegraNegocioError('O custo unitário não pode ser negativo');
  }
  const estoque = Math.max(0, estoqueAtual);
  if (estoque === 0) return custoNovo.toDecimalPlaces(4);
  const total = new Decimal(custoAtual).mul(estoque).add(custoNovo.mul(quantidadeEntrada));
  return total.div(estoque + quantidadeEntrada).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function estaAbaixoDoMinimo(estoqueAtual: number, estoqueMinimo: number): boolean {
  return estoqueAtual <= estoqueMinimo;
}
