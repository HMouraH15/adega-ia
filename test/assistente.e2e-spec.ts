import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { formatarData } from '../src/domain/periodo';
import { LLM_PROVIDER, LlmErro, LlmProvider, RequisicaoLlm, RespostaLlm } from '../src/modules/assistente/llm/llm.types';

/**
 * Assistente de IA contra o banco real, com um provedor FALSO no lugar do Gemini:
 * nenhuma chamada sai para a API real. Verifica ferramentas lendo dados reais,
 * gravação do histórico (com o conteúdo nativo), continuação, 429 e rate limit.
 */
class ProvedorFalso implements LlmProvider {
  readonly nome = 'gemini' as const;
  readonly modelo = 'modelo-falso';
  readonly recebidas: RequisicaoLlm[] = [];
  private roteiro: Array<(req: RequisicaoLlm) => RespostaLlm> = [];

  programar(...passos: Array<(req: RequisicaoLlm) => RespostaLlm>) {
    this.roteiro.push(...passos);
  }

  async chat(req: RequisicaoLlm): Promise<RespostaLlm> {
    this.recebidas.push(JSON.parse(JSON.stringify(req)));
    const passo = this.roteiro.shift();
    if (!passo) throw new Error('roteiro do provedor falso acabou');
    return passo(req);
  }
}

const uso = { entrada: 120, saida: 15, cacheLeitura: 0, cacheEscrita: 0 };
const nativo = (marca: string) => ({ role: 'model', parts: [{ text: marca, thoughtSignature: `SIG-${marca}` }] });

describe('Assistente (e2e, banco real, provedor falso)', () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  const falso = new ProvedorFalso();
  const hoje = formatarData(new Date(), process.env.FUSO_HORARIO ?? '-03:00');

  async function chat(corpo: object, tk = token) {
    const r = await fetch(`${base}/api/assistente/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` },
      body: JSON.stringify(corpo),
    });
    return { status: r.status, body: await r.json() };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(falso)
      .compile();
    app = mod.createNestApplication({ logger: ['error'] });
    configurarApp(app);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.E2E_ADMIN_EMAIL, senha: process.env.E2E_ADMIN_SENHA }),
    });
    token = (await login.json()).accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  let conversaId: string;

  it('pergunta → ferramenta lê o banco real → resposta; tudo gravado na conversa', async () => {
    falso.programar(
      () => ({
        blocos: [{ tipo: 'chamada', id: 'fc-1', nome: 'relatorio_lucro', entrada: { inicio: hoje, fim: hoje } }],
        parada: 'ferramentas',
        uso,
        modelo: 'modelo-falso',
        nativo: nativo('chamada'),
      }),
      (req) => {
        // O modelo recebe o resultado REAL da ferramenta (consulta ao PostgreSQL)
        const resultado = req.mensagens.at(-1)!.blocos[0];
        if (resultado.tipo !== 'resultado') throw new Error('esperava resultado de ferramenta');
        const dados = JSON.parse(resultado.conteudo);
        return {
          blocos: [{ tipo: 'texto', texto: `Período ${dados.periodo.inicio} a ${dados.periodo.fim}: ${dados.quantidadeVendas} vendas.` }],
          parada: 'fim',
          uso,
          modelo: 'modelo-falso',
          nativo: nativo('final'),
        };
      },
    );

    const r = await chat({ mensagem: 'Qual o lucro de hoje?' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ provedor: 'gemini', ferramentasUsadas: ['relatorio_lucro'], acoes: [], truncada: false });
    expect(r.body.resposta).toMatch(new RegExp(`Período ${hoje} a ${hoje}: \\d+ vendas\\.`));
    expect(r.body.uso).toEqual({ entrada: 240, saida: 30, cacheLeitura: 0, cacheEscrita: 0, chamadas: 2 });
    conversaId = r.body.conversaId;

    const historico = await (await fetch(`${base}/api/assistente/conversas/${conversaId}`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(historico).toMatchObject({ provedor: 'gemini', modelo: 'modelo-falso', tokensEntrada: 240, tokensSaida: 30, chamadasModelo: 2 });
    expect(historico.mensagens.map((m: { papel: string }) => m.papel)).toEqual(['user', 'assistant']);
  });

  it('continuação reenvia o histórico com o conteúdo nativo (thought signatures) intacto', async () => {
    falso.programar(() => ({ blocos: [{ tipo: 'texto', texto: 'Certo.' }], parada: 'fim', uso, modelo: 'modelo-falso', nativo: nativo('2') }));

    const r = await chat({ mensagem: 'Obrigado', conversaId });
    expect(r.status).toBe(200);

    const enviada = falso.recebidas.at(-1)!;
    expect(enviada.mensagens.map((m) => m.papel)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(enviada.mensagens[1].nativo).toEqual(nativo('chamada'));
    expect(enviada.mensagens[3].nativo).toEqual(nativo('final'));
  });

  it('429 do provedor (cota do plano gratuito) → mensagem amigável e nada gravado', async () => {
    falso.programar(() => {
      throw new LlmErro('limite_uso', 'RESOURCE_EXHAUSTED', 429);
    });
    const antes = falso.recebidas.length;

    const r = await chat({ mensagem: 'Mais uma pergunta', conversaId });

    expect(r.status).toBe(429);
    expect(r.body.message).toBe('Limite de uso do assistente atingido. Tente novamente em alguns minutos.');
    expect(falso.recebidas.length).toBe(antes + 1);
    const historico = await (await fetch(`${base}/api/assistente/conversas/${conversaId}`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(historico.mensagens).toHaveLength(4); // o turno com erro não foi gravado
  });

  it('VENDEDOR não acessa o assistente', async () => {
    await fetch(`${base}/api/auth/registrar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ nome: 'Vendedor IA', email: 'vendedor.ia@adega.local', senha: 'senha-vendedor' }),
    });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'vendedor.ia@adega.local', senha: 'senha-vendedor' }),
    });
    expect((await chat({ mensagem: 'oi' }, (await login.json()).accessToken)).status).toBe(403);
  });

  it('rate limit interno por usuário bloqueia antes de gastar cota do provedor', async () => {
    const limite = Number(process.env.ASSISTENTE_RATE_LIMIT);
    // 3 requisições de chat deste ADMIN já foram feitas nos testes anteriores
    for (let i = 3; i < limite; i++) {
      falso.programar(() => ({ blocos: [{ tipo: 'texto', texto: 'ok' }], parada: 'fim', uso, modelo: 'modelo-falso', nativo: nativo('x') }));
      expect((await chat({ mensagem: `pergunta ${i}` })).status).toBe(200);
    }
    const chamadasAntes = falso.recebidas.length;
    const bloqueada = await chat({ mensagem: 'uma a mais' });
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.message).toMatch(/Muitas perguntas em pouco tempo/);
    expect(falso.recebidas.length).toBe(chamadasAntes); // o provedor nem foi chamado
  });
});
