import { RegraNegocioError } from './errors';
import { criarPeriodo, ultimosDias } from './periodo';
import { sugerirPreco } from './preco.rules';
import { sugerirReposicao } from './reposicao.rules';

describe('sugerirReposicao', () => {
  it('sugere a diferença entre o alvo (média × cobertura + mínimo) e o estoque', () => {
    // média = 60/30 = 2/dia; alvo = 2×15 + 5 = 35; estoque 10 → repor 25
    const r = sugerirReposicao({
      estoqueAtual: 10,
      estoqueMinimo: 5,
      vendidoNoPeriodo: 60,
      diasHistorico: 30,
      diasCobertura: 15,
    });
    expect(r).toEqual({ mediaDiaria: 2, diasRestantes: 5, quantidadeSugerida: 25, precisaRepor: true });
  });

  it('não sugere nada quando o estoque cobre o alvo', () => {
    const r = sugerirReposicao({
      estoqueAtual: 100,
      estoqueMinimo: 5,
      vendidoNoPeriodo: 30,
      diasHistorico: 30,
      diasCobertura: 15,
    });
    expect(r.quantidadeSugerida).toBe(0);
    expect(r.precisaRepor).toBe(false);
  });

  it('sem vendas, repõe só até o mínimo e diasRestantes é null', () => {
    const r = sugerirReposicao({
      estoqueAtual: 1,
      estoqueMinimo: 4,
      vendidoNoPeriodo: 0,
      diasHistorico: 30,
      diasCobertura: 15,
    });
    expect(r.diasRestantes).toBeNull();
    expect(r.quantidadeSugerida).toBe(3);
  });

  it('arredonda a sugestão para cima', () => {
    // média 1/3; alvo = 1/3 × 10 = 3.33 → 4
    const r = sugerirReposicao({
      estoqueAtual: 0,
      estoqueMinimo: 0,
      vendidoNoPeriodo: 10,
      diasHistorico: 30,
      diasCobertura: 10,
    });
    expect(r.quantidadeSugerida).toBe(4);
  });

  it('rejeita janelas inválidas', () => {
    const base = { estoqueAtual: 1, estoqueMinimo: 1, vendidoNoPeriodo: 1 };
    expect(() => sugerirReposicao({ ...base, diasHistorico: 0, diasCobertura: 1 })).toThrow(RegraNegocioError);
    expect(() => sugerirReposicao({ ...base, diasHistorico: 1, diasCobertura: 0 })).toThrow(RegraNegocioError);
  });
});

describe('sugerirPreco', () => {
  it('preço = custo / (1 − margem)', () => {
    // 60 / (1 − 0.4) = 100
    const s = sugerirPreco(60, 40);
    expect(s.precoSugerido.toFixed(2)).toBe('100.00');
    expect(s.margemResultantePercentual!.toFixed(2)).toBe('40.00');
    expect(s.markupPercentual!.toFixed(2)).toBe('66.67');
  });

  it('arredonda para cima nos centavos para não ficar abaixo da margem', () => {
    // 10 / 0.7 = 14.2857… → 14.29
    const s = sugerirPreco(10, 30);
    expect(s.precoSugerido.toFixed(2)).toBe('14.29');
    expect(s.margemResultantePercentual!.toNumber()).toBeGreaterThanOrEqual(30);
  });

  it.each([0, 100, -5, 150])('rejeita margem %p', (m) => {
    expect(() => sugerirPreco(10, m)).toThrow(RegraNegocioError);
  });

  it('rejeita custo zero', () => {
    expect(() => sugerirPreco(0, 30)).toThrow(RegraNegocioError);
  });
});

describe('periodo', () => {
  it('cria período fechado no fuso da loja', () => {
    const p = criarPeriodo('2026-11-01', '2026-11-30', '-03:00');
    expect(p.inicio.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(p.fimExclusivo.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(p.dias).toBe(30);
  });

  it('rejeita datas inválidas e intervalo invertido', () => {
    expect(() => criarPeriodo('2026-02-30', '2026-03-01', '-03:00')).toThrow(RegraNegocioError);
    expect(() => criarPeriodo('01/11/2026', '2026-11-30', '-03:00')).toThrow(RegraNegocioError);
    expect(() => criarPeriodo('2026-11-10', '2026-11-01', '-03:00')).toThrow(RegraNegocioError);
  });

  it('ultimosDias inclui hoje no fuso da loja', () => {
    // 01:00 UTC do dia 10 ainda é dia 9 em -03:00
    const p = ultimosDias(7, '-03:00', new Date('2026-11-10T01:00:00Z'));
    expect(p.inicioTexto).toBe('2026-11-03');
    expect(p.fimTexto).toBe('2026-11-09');
    expect(p.dias).toBe(7);
  });
});
