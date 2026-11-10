import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { formatarData } from '../src/domain/periodo';

/**
 * Fluxo completo contra PostgreSQL real:
 * login → cadastros → compras → vendas → cancelamento → relatório de lucro.
 * Os testes são sequenciais e cada um depende do estado deixado pelo anterior.
 */
describe('Fluxo da adega (e2e, banco real)', () => {
  let app: INestApplication;
  let base: string;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let produtoId: string;
  let fornecedorId: string;
  let vendaComDescontoId: string;
  const hoje = formatarData(new Date(), process.env.FUSO_HORARIO ?? '-03:00');

  async function req(metodo: string, caminho: string, corpo?: unknown, token?: string) {
    const r = await fetch(`${base}/api${caminho}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, body: texto ? JSON.parse(texto) : undefined };
  }
  const estoque = async () => (await req('GET', `/produtos/${produtoId}`, undefined, tokenAdmin)).body;
  const lucro = async () =>
    (await req('GET', `/relatorios/lucro?inicio=${hoje}&fim=${hoje}`, undefined, tokenAdmin)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ logger: ['error'] });
    configurarApp(app);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('1. login: rejeita senha errada e autentica o ADMIN criado pelo seed', async () => {
    const errado = await req('POST', '/auth/login', { email: process.env.E2E_ADMIN_EMAIL, senha: 'senha-errada' });
    expect(errado.status).toBe(401);

    const ok = await req('POST', '/auth/login', { email: process.env.E2E_ADMIN_EMAIL, senha: process.env.E2E_ADMIN_SENHA });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    tokenAdmin = ok.body.accessToken;

    expect((await req('GET', '/produtos')).status).toBe(401);
  });

  it('2. ADMIN cadastra vendedor, categoria, fornecedor e produto', async () => {
    const vendedor = await req(
      'POST',
      '/auth/registrar',
      { nome: 'Vendedora E2E', email: 'vendedora.e2e@adega.local', senha: 'senha-vendedora' },
      tokenAdmin,
    );
    expect(vendedor.status).toBe(201);
    expect(vendedor.body).not.toHaveProperty('senhaHash');
    tokenVendedor = (await req('POST', '/auth/login', { email: 'vendedora.e2e@adega.local', senha: 'senha-vendedora' })).body
      .accessToken;

    const categoria = await req('POST', '/categorias', { nome: 'Vinhos E2E' }, tokenAdmin);
    expect(categoria.status).toBe(201);

    const fornecedor = await req('POST', '/fornecedores', { nome: 'Fornecedor E2E' }, tokenAdmin);
    expect(fornecedor.status).toBe(201);
    fornecedorId = fornecedor.body.id;

    const produto = await req(
      'POST',
      '/produtos',
      { nome: 'Malbec E2E', categoriaId: categoria.body.id, precoCusto: 0, precoVenda: 80, estoqueMinimo: 5 },
      tokenAdmin,
    );
    expect(produto.status).toBe(201);
    expect(produto.body.estoqueAtual).toBe(0);
    produtoId = produto.body.id;
  });

  it('3. compras aumentam o estoque e ajustam o custo médio ponderado', async () => {
    const c1 = await req('POST', '/compras', { fornecedorId, itens: [{ produtoId, quantidade: 10, custoUnitario: 40 }] }, tokenAdmin);
    expect(c1.status).toBe(201);
    expect(c1.body.valorTotal).toBe('400');

    const c2 = await req('POST', '/compras', { fornecedorId, itens: [{ produtoId, quantidade: 10, custoUnitario: 50 }] }, tokenAdmin);
    expect(c2.status).toBe(201);

    const p = await estoque();
    expect(p.estoqueAtual).toBe(20);
    expect(p.precoCusto).toBe('45'); // (10×40 + 10×50) / 20

    expect((await req('POST', '/compras', { fornecedorId, itens: [{ produtoId, quantidade: 1, custoUnitario: 1 }] }, tokenVendedor)).status).toBe(403);
  });

  it('4. vendas baixam o estoque e gravam o custo do momento para o lucro', async () => {
    const v1 = await req('POST', '/vendas', { itens: [{ produtoId, quantidade: 3 }] }, tokenVendedor);
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ valorTotal: '240', custoTotal: '135', lucro: '105', status: 'CONCLUIDA' });
    expect(v1.body.itens[0].custoUnitario).toBe('45');

    const v2 = await req('POST', '/vendas', { itens: [{ produtoId, quantidade: 2, precoUnitario: 70 }] }, tokenAdmin);
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ valorTotal: '140', custoTotal: '90', lucro: '50' });
    vendaComDescontoId = v2.body.id;

    expect((await estoque()).estoqueAtual).toBe(15);
  });

  it('5. venda acima do estoque é recusada sem alterar nada', async () => {
    const r = await req('POST', '/vendas', { itens: [{ produtoId, quantidade: 16 }] }, tokenVendedor);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Estoque insuficiente/);

    const repetido = await req(
      'POST',
      '/vendas',
      { itens: [{ produtoId, quantidade: 8 }, { produtoId, quantidade: 8 }] },
      tokenVendedor,
    );
    expect(repetido.status).toBe(422);
    expect((await estoque()).estoqueAtual).toBe(15);
  });

  it('6. relatório de lucro do dia antes do cancelamento', async () => {
    expect(await lucro()).toMatchObject({
      periodo: { inicio: hoje, fim: hoje, dias: 1 },
      semDados: false,
      quantidadeVendas: 2,
      receita: '380.00',
      custo: '225.00',
      lucro: '155.00',
      margemPercentual: '40.79',
    });
  });

  it('7. cancelamento: só ADMIN, devolve o estoque, não repete e tira a venda do relatório', async () => {
    const porVendedor = await req('POST', `/vendas/${vendaComDescontoId}/cancelar`, { motivo: 'teste' }, tokenVendedor);
    expect(porVendedor.status).toBe(403);

    const semMotivo = await req('POST', `/vendas/${vendaComDescontoId}/cancelar`, {}, tokenAdmin);
    expect(semMotivo.status).toBe(400);

    const ok = await req('POST', `/vendas/${vendaComDescontoId}/cancelar`, { motivo: 'Cliente desistiu' }, tokenAdmin);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'CANCELADA', motivoCancelamento: 'Cliente desistiu' });
    expect(ok.body.canceladaEm).toEqual(expect.any(String));

    const p = await estoque();
    expect(p.estoqueAtual).toBe(17);
    expect(p.precoCusto).toBe('45'); // devolvido ao mesmo custo: média não muda

    const deNovo = await req('POST', `/vendas/${vendaComDescontoId}/cancelar`, { motivo: 'de novo' }, tokenAdmin);
    expect(deNovo.status).toBe(422);
    expect((await estoque()).estoqueAtual).toBe(17);
  });

  it('8. relatório de lucro depois do cancelamento considera só vendas concluídas', async () => {
    expect(await lucro()).toMatchObject({
      quantidadeVendas: 1,
      receita: '240.00',
      custo: '135.00',
      lucro: '105.00',
      margemPercentual: '43.75',
    });

    const vazio = (await req('GET', '/relatorios/lucro?inicio=2020-01-01&fim=2020-01-31', undefined, tokenAdmin)).body;
    expect(vazio).toMatchObject({ semDados: true, quantidadeVendas: 0, lucro: '0.00', margemPercentual: null });

    expect((await req('GET', `/relatorios/lucro?inicio=${hoje}&fim=${hoje}`, undefined, tokenVendedor)).status).toBe(403);
  });

  it('9. vendas simultâneas nunca deixam o estoque negativo', async () => {
    // Estoque 17; 6 vendas paralelas de 4 → no máximo 4 passam (16), sobra 1
    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => req('POST', '/vendas', { itens: [{ produtoId, quantidade: 4 }] }, tokenVendedor)),
    );
    const status = resultados.map((r) => r.status).sort();
    expect(status).toEqual([201, 201, 201, 201, 422, 422]);
    expect((await estoque()).estoqueAtual).toBe(1);

    const estoqueBaixo = (await req('GET', '/produtos/estoque-baixo', undefined, tokenAdmin)).body;
    expect(estoqueBaixo.map((p: { id: string }) => p.id)).toContain(produtoId);
  });
});
