import { Logger } from '@nestjs/common';
import { CAMPOS_PERMITIDOS, mascararPadroesPessoais, protegerDadosPessoais } from './privacidade';

beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

describe('protegerDadosPessoais', () => {
  it('remove qualquer campo fora da lista permitida, em qualquer nível', () => {
    const entrada = {
      semDados: false,
      produtos: [{ id: 'p1', nome: 'Malbec', estoque: 3, email: 'a@b.com', telefone: '11999990000' }],
      periodo: { inicio: '2026-11-01', fim: '2026-11-10', dias: 10 },
      cliente: { nome: 'Fulano', endereco: 'Rua X, 10' },
      usuarioId: 'u1',
      vendedor: 'Maria',
      contato: '(11) 4000-0000',
      documento: '12.345.678/0001-90',
    };
    expect(protegerDadosPessoais(entrada)).toEqual({
      semDados: false,
      produtos: [{ id: 'p1', nome: 'Malbec', estoque: 3 }],
      periodo: { inicio: '2026-11-01', fim: '2026-11-10', dias: 10 },
    });
  });

  it('mascara e-mail, telefone, CPF, CNPJ e CEP dentro de textos livres', () => {
    expect(mascararPadroesPessoais('Gin (encomenda joao@gmail.com, tel (11) 98765-4321)')).toBe(
      'Gin (encomenda [removido], tel [removido])',
    );
    expect(mascararPadroesPessoais('CPF 123.456.789-09 / CNPJ 12.345.678/0001-90 / CEP 01310-100')).toBe(
      'CPF [removido] / CNPJ [removido] / CEP [removido]',
    );
  });

  it('não altera dados de negócio: ids, datas, valores e nomes de produtos', () => {
    const dados = {
      id: '11111111-1111-4111-8111-111111111111',
      nome: 'Vinho Tinto Malbec 750ml Safra 2021',
      inicio: '2026-11-01',
      receita: '12345.67',
      quantidade: 1500,
    };
    expect(protegerDadosPessoais(dados)).toEqual(dados);
  });

  it('a lista permitida não contém nenhum campo típico de dado pessoal', () => {
    for (const proibido of ['email', 'telefone', 'celular', 'endereco', 'cpf', 'cnpj', 'documento', 'contato', 'cliente', 'usuario', 'usuarioId', 'senhaHash', 'fornecedor', 'motivoCancelamento']) {
      expect(CAMPOS_PERMITIDOS.has(proibido)).toBe(false);
    }
  });
});
