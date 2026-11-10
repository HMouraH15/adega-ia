import { EstoqueInsuficienteError, RegraNegocioError } from './errors';
import {
  agruparItens,
  calcularBaixa,
  custoMedioPonderado,
  estaAbaixoDoMinimo,
  validarQuantidade,
} from './estoque.rules';

describe('estoque.rules', () => {
  describe('validarQuantidade', () => {
    it.each([0, -1, 1.5, NaN])('rejeita %p', (q) => {
      expect(() => validarQuantidade(q)).toThrow(RegraNegocioError);
    });
    it('aceita inteiro positivo', () => {
      expect(() => validarQuantidade(3)).not.toThrow();
    });
  });

  describe('calcularBaixa', () => {
    it('diminui o estoque', () => {
      expect(calcularBaixa('p1', 10, 3)).toBe(7);
    });
    it('permite baixar exatamente o estoque disponível (fica em zero)', () => {
      expect(calcularBaixa('p1', 5, 5)).toBe(0);
    });
    it('lança EstoqueInsuficienteError quando a quantidade passa do estoque', () => {
      expect(() => calcularBaixa('p1', 2, 3)).toThrow(EstoqueInsuficienteError);
    });
    it('rejeita quantidade zero', () => {
      expect(() => calcularBaixa('p1', 10, 0)).toThrow(RegraNegocioError);
    });
  });

  describe('agruparItens', () => {
    it('soma linhas repetidas do mesmo produto', () => {
      const mapa = agruparItens([
        { produtoId: 'a', quantidade: 2 },
        { produtoId: 'b', quantidade: 1 },
        { produtoId: 'a', quantidade: 3 },
      ]);
      expect(mapa.get('a')).toBe(5);
      expect(mapa.get('b')).toBe(1);
    });
    it('itens repetidos que juntos ultrapassam o estoque são barrados na baixa', () => {
      const total = agruparItens([
        { produtoId: 'a', quantidade: 3 },
        { produtoId: 'a', quantidade: 3 },
      ]).get('a')!;
      expect(() => calcularBaixa('a', 5, total)).toThrow(EstoqueInsuficienteError);
    });
  });

  describe('custoMedioPonderado', () => {
    it('com estoque zero, o custo passa a ser o da compra', () => {
      expect(custoMedioPonderado(0, 10, 5, 12).toString()).toBe('12');
    });
    it('pondera pelo estoque existente', () => {
      // (10 × 20 + 30 × 24) / 40 = 23
      expect(custoMedioPonderado(10, 20, 30, 24).toString()).toBe('23');
    });
    it('arredonda para 4 casas', () => {
      // (1 × 10 + 2 × 11) / 3 = 10.6666…
      expect(custoMedioPonderado(1, 10, 2, 11).toString()).toBe('10.6667');
    });
    it('trata estoque negativo como zero', () => {
      expect(custoMedioPonderado(-3, 99, 2, 7).toString()).toBe('7');
    });
    it('rejeita custo negativo', () => {
      expect(() => custoMedioPonderado(1, 10, 1, -1)).toThrow(RegraNegocioError);
    });
  });

  it('estaAbaixoDoMinimo considera igual ao mínimo como alerta', () => {
    expect(estaAbaixoDoMinimo(5, 5)).toBe(true);
    expect(estaAbaixoDoMinimo(6, 5)).toBe(false);
  });
});
