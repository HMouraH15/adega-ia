import { RegraNegocioError } from './errors';

export interface EntradaReposicao {
  estoqueAtual: number;
  estoqueMinimo: number;
  /** Unidades vendidas na janela de histórico */
  vendidoNoPeriodo: number;
  /** Tamanho da janela de histórico, em dias */
  diasHistorico: number;
  /** Quantos dias de venda a reposição deve cobrir */
  diasCobertura: number;
}

export interface ResultadoReposicao {
  mediaDiaria: number;
  /** Dias até zerar o estoque no ritmo atual; null se não há vendas */
  diasRestantes: number | null;
  quantidadeSugerida: number;
  precisaRepor: boolean;
}

/**
 * Sugestão de reposição baseada na média de vendas diárias:
 * alvo = média × diasCobertura + estoqueMinimo; sugerido = max(0, ceil(alvo − estoque)).
 */
export function sugerirReposicao(e: EntradaReposicao): ResultadoReposicao {
  if (!Number.isInteger(e.diasHistorico) || e.diasHistorico <= 0) {
    throw new RegraNegocioError('diasHistorico deve ser um inteiro maior que zero');
  }
  if (!Number.isInteger(e.diasCobertura) || e.diasCobertura <= 0) {
    throw new RegraNegocioError('diasCobertura deve ser um inteiro maior que zero');
  }
  const mediaDiaria = e.vendidoNoPeriodo / e.diasHistorico;
  const estoque = Math.max(0, e.estoqueAtual);
  const alvo = mediaDiaria * e.diasCobertura + e.estoqueMinimo;
  // Arredonda o alvo antes do ceil para não sugerir 1 unidade extra por ruído de ponto flutuante
  const quantidadeSugerida = Math.max(0, Math.ceil(Number((alvo - estoque).toFixed(6))));
  return {
    mediaDiaria: Number(mediaDiaria.toFixed(2)),
    diasRestantes: mediaDiaria > 0 ? Number((estoque / mediaDiaria).toFixed(1)) : null,
    quantidadeSugerida,
    precisaRepor: quantidadeSugerida > 0,
  };
}
