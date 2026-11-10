import { RegraNegocioError } from './errors';
import { calcularItem, calcularTotaisVenda, margemPercentual } from './lucro.rules';

describe('lucro.rules', () => {
  it('calcula receita, custo e lucro de um item', () => {
    const t = calcularItem({ quantidade: 3, precoUnitario: '50.00', custoUnitario: '30.00' });
    expect(t.receita.toString()).toBe('150');
    expect(t.custo.toString()).toBe('90');
    expect(t.lucro.toString()).toBe('60');
  });

  it('soma vários itens', () => {
    const t = calcularTotaisVenda([
      { quantidade: 2, precoUnitario: 40, custoUnitario: 25 },
      { quantidade: 1, precoUnitario: '19.90', custoUnitario: '8.5' },
    ]);
    expect(t.valorTotal.toFixed(2)).toBe('99.90');
    expect(t.custoTotal.toFixed(2)).toBe('58.50');
    expect(t.lucro.toFixed(2)).toBe('41.40');
  });

  it('registra prejuízo quando o preço fica abaixo do custo', () => {
    const t = calcularTotaisVenda([{ quantidade: 2, precoUnitario: 10, custoUnitario: 12 }]);
    expect(t.lucro.toFixed(2)).toBe('-4.00');
  });

  it('usa precisão decimal e arredonda só no total (sem erro de ponto flutuante)', () => {
    // 0.1 + 0.2 em float daria 0.30000000000000004
    const t = calcularTotaisVenda([
      { quantidade: 1, precoUnitario: '0.10', custoUnitario: 0 },
      { quantidade: 1, precoUnitario: '0.20', custoUnitario: 0 },
    ]);
    expect(t.valorTotal.toFixed(2)).toBe('0.30');
  });

  it('custo médio com 4 casas é arredondado para centavos no total', () => {
    // 3 × 10.6667 = 32.0001 → 32.00
    const t = calcularTotaisVenda([{ quantidade: 3, precoUnitario: 15, custoUnitario: '10.6667' }]);
    expect(t.custoTotal.toFixed(2)).toBe('32.00');
    expect(t.lucro.toFixed(2)).toBe('13.00');
    expect(t.valorTotal.sub(t.custoTotal).equals(t.lucro)).toBe(true);
  });

  it('rejeita venda sem itens, preço negativo e quantidade inválida', () => {
    expect(() => calcularTotaisVenda([])).toThrow(RegraNegocioError);
    expect(() => calcularItem({ quantidade: 1, precoUnitario: -1, custoUnitario: 1 })).toThrow(RegraNegocioError);
    expect(() => calcularItem({ quantidade: 0, precoUnitario: 1, custoUnitario: 1 })).toThrow(RegraNegocioError);
  });

  it('margemPercentual', () => {
    expect(margemPercentual(200, 50)!.toString()).toBe('25');
    expect(margemPercentual(0, 0)).toBeNull();
  });
});
