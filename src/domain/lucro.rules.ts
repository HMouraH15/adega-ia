import { Decimal, ValorDecimal } from './decimal';
import { RegraNegocioError } from './errors';
import { validarQuantidade } from './estoque.rules';


export interface ItemVendaCalculo {
  quantidade: number;
  precoUnitario: ValorDecimal;
  /** Custo do produto no momento da venda */
  custoUnitario: ValorDecimal;
}

export interface TotaisItem {
  receita: Decimal;
  custo: Decimal;
  lucro: Decimal;
}

export interface TotaisVenda {
  valorTotal: Decimal;
  custoTotal: Decimal;
  lucro: Decimal;
}

const centavos = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function calcularItem(item: ItemVendaCalculo): TotaisItem {
  validarQuantidade(item.quantidade);
  const preco = new Decimal(item.precoUnitario);
  const custo = new Decimal(item.custoUnitario);
  if (preco.isNegative()) throw new RegraNegocioError('O preço de venda não pode ser negativo');
  if (custo.isNegative()) throw new RegraNegocioError('O custo não pode ser negativo');
  const receita = preco.mul(item.quantidade);
  const custoTotal = custo.mul(item.quantidade);
  return { receita, custo: custoTotal, lucro: receita.sub(custoTotal) };
}

/**
 * Totais da venda. Soma em precisão total e arredonda para centavos só no fim;
 * o lucro é derivado dos totais arredondados para que valorTotal − custoTotal = lucro.
 */
export function calcularTotaisVenda(itens: ItemVendaCalculo[]): TotaisVenda {
  if (itens.length === 0) throw new RegraNegocioError('A venda deve ter ao menos um item');
  let receita = new Decimal(0);
  let custo = new Decimal(0);
  for (const item of itens) {
    const t = calcularItem(item);
    receita = receita.add(t.receita);
    custo = custo.add(t.custo);
  }
  const valorTotal = centavos(receita);
  const custoTotal = centavos(custo);
  return { valorTotal, custoTotal, lucro: valorTotal.sub(custoTotal) };
}

/** Margem sobre a receita, em percentual (ex.: 25.5). null quando não há receita. */
export function margemPercentual(receita: ValorDecimal, lucro: ValorDecimal): Decimal | null {
  const r = new Decimal(receita);
  if (r.isZero()) return null;
  return new Decimal(lucro).div(r).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
