import { Decimal, ValorDecimal } from './decimal';
import { RegraNegocioError } from './errors';
import { margemPercentual } from './lucro.rules';


export interface SugestaoPreco {
  precoSugerido: Decimal;
  margemDesejadaPercentual: Decimal;
  /** Margem que o preço sugerido realmente dá, após arredondar para centavos */
  margemResultantePercentual: Decimal | null;
  markupPercentual: Decimal | null;
}

/**
 * Preço de venda para atingir uma margem sobre o preço (margem = lucro / preço):
 * preço = custo / (1 − margem). Arredonda para cima nos centavos para nunca
 * ficar abaixo da margem pedida.
 */
export function sugerirPreco(custo: ValorDecimal, margemDesejadaPercentual: number): SugestaoPreco {
  const c = new Decimal(custo);
  if (c.isNegative() || c.isZero()) {
    throw new RegraNegocioError('O custo precisa ser maior que zero para sugerir preço');
  }
  if (!(margemDesejadaPercentual > 0 && margemDesejadaPercentual < 100)) {
    throw new RegraNegocioError('A margem desejada deve estar entre 0 e 100 (exclusivo)');
  }
  const margem = new Decimal(margemDesejadaPercentual).div(100);
  const preco = c.div(new Decimal(1).sub(margem)).toDecimalPlaces(2, Decimal.ROUND_UP);
  return {
    precoSugerido: preco,
    margemDesejadaPercentual: new Decimal(margemDesejadaPercentual),
    margemResultantePercentual: margemPercentual(preco, preco.sub(c)),
    markupPercentual: preco.sub(c).div(c).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
}
