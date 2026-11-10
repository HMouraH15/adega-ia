import { HttpException, Logger } from '@nestjs/common';
import { ConfigAssistente } from './assistente.config';
import { PROMPT_SISTEMA } from './assistente.prompt';
import { AssistenteService, MENSAGEM_LIMITE_USO } from './assistente.service';
import { AcaoSugerida, FerramentasAssistente } from './ferramentas';
import { BlocoLlm, LlmErro, LlmProvider, MotivoParada, RequisicaoLlm, RespostaLlm, TipoErroLlm } from './llm/llm.types';

const CONFIG: ConfigAssistente = {
  habilitado: true,
  provedor: 'gemini',
  maxTokens: 2048,
  timeoutMs: 30_000,
  maxRetries: 0,
  maxIteracoes: 4,
  maxTokensContexto: 30_000,
  fuso: '-03:00',
  gemini: { apiKey: 'chave-falsa', modelo: 'gemini-3.8-flash' },
  anthropic: { apiKey: '', modelo: 'claude-haiku-5-5' },
};

function resposta(blocos: BlocoLlm[], parada: MotivoParada, uso: Partial<RespostaLlm['uso']> = {}): RespostaLlm {
  return {
    blocos,
    parada,
    uso: { entrada: 100, saida: 20, cacheLeitura: 0, cacheEscrita: 0, ...uso },
    modelo: 'gemini-3.8-flash',
    nativo: { role: 'model', parts: [{ text: 'nativo', thoughtSignature: 'assinatura-opaca' }] },
  };
}
const texto = (t: string): BlocoLlm => ({ tipo: 'texto', texto: t });
const chamada = (id: string, nome: string, entrada: Record<string, unknown> = {}): BlocoLlm => ({
  tipo: 'chamada',
  id,
  nome,
  entrada,
});

function montar(opcoes: { config?: Partial<ConfigAssistente>; semProvider?: boolean; conversa?: object | null } = {}) {
  const chat = jest.fn<Promise<RespostaLlm>, [RequisicaoLlm]>();
  const llm: LlmProvider = { nome: 'gemini', modelo: 'gemini-3.8-flash', chat };
  const tx = {
    conversa: { create: jest.fn(), update: jest.fn() },
    mensagem: { createMany: jest.fn() },
  };
  const prisma = {
    conversa: { findFirst: jest.fn().mockResolvedValue(opcoes.conversa ?? null) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const ferramentas = { executar: jest.fn() } as unknown as jest.Mocked<FerramentasAssistente>;
  const service = new AssistenteService(prisma as any, ferramentas, { ...CONFIG, ...opcoes.config }, opcoes.semProvider ? null : llm);
  return { service, chat, tx, prisma, ferramentas };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('AssistenteService — chamada de ferramentas', () => {
  it('executa a ferramenta pedida, devolve o resultado ao modelo e grava o turno completo', async () => {
    const { service, chat, tx, ferramentas } = montar();
    chat
      .mockResolvedValueOnce(resposta([chamada('c1', 'estoque_baixo')], 'ferramentas'))
      .mockResolvedValueOnce(
        resposta([texto('Há 1 produto abaixo do mínimo: Malbec 750ml (3 un., mínimo 6).')], 'fim', {
          entrada: 150,
          saida: 30,
          cacheLeitura: 900,
        }),
      );
    ferramentas.executar.mockResolvedValue({ conteudo: '{"semDados":false,"produtos":[]}', erro: false });

    const r = await service.chat('u1', 'O que está com estoque baixo?');

    expect(ferramentas.executar).toHaveBeenCalledWith('estoque_baixo', {});
    expect(chat).toHaveBeenCalledTimes(2);

    // A 2ª chamada leva: pergunta, chamada (com o conteúdo nativo) e o resultado correspondente
    const msgs = chat.mock.calls[1][0].mensagens;
    expect(msgs.map((m) => m.papel)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[1].nativo).toEqual({ role: 'model', parts: [{ text: 'nativo', thoughtSignature: 'assinatura-opaca' }] });
    expect(msgs[2].blocos).toEqual([
      { tipo: 'resultado', idChamada: 'c1', nome: 'estoque_baixo', conteudo: '{"semDados":false,"produtos":[]}', erro: false },
    ]);

    expect(r.resposta).toContain('Malbec');
    expect(r.ferramentasUsadas).toEqual(['estoque_baixo']);
    expect(r.provedor).toBe('gemini');
    expect(r.uso).toEqual({ entrada: 250, saida: 50, cacheLeitura: 900, cacheEscrita: 0, chamadas: 2 });

    expect(tx.conversa.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: r.conversaId, usuarioId: 'u1', provedor: 'gemini', modelo: 'gemini-3.8-flash' }),
    });
    const gravadas = tx.mensagem.createMany.mock.calls[0][0].data;
    expect(gravadas.map((m: any) => [m.ordem, m.papel])).toEqual([
      [0, 'user'],
      [1, 'assistant'],
      [2, 'user'],
      [3, 'assistant'],
    ]);
    // O conteúdo nativo (thought signature) é gravado para ser reenviado igual depois
    expect(gravadas[1].nativo).toEqual(expect.objectContaining({ role: 'model' }));
    expect(tx.conversa.update.mock.calls[0][0].data).toMatchObject({
      tokensEntrada: { increment: 250 },
      tokensSaida: { increment: 50 },
      tokensCacheLeitura: { increment: 900 },
      chamadasModelo: { increment: 2 },
      tamanhoContexto: 1050,
    });
  });

  it('envia todos os resultados de chamadas paralelas numa única mensagem', async () => {
    const { service, chat, ferramentas } = montar();
    chat
      .mockResolvedValueOnce(
        resposta(
          [
            chamada('c1', 'relatorio_lucro', { inicio: '2026-11-01', fim: '2026-11-10' }),
            chamada('c2', 'produtos_mais_vendidos', { inicio: '2026-11-01', fim: '2026-11-10' }),
          ],
          'ferramentas',
        ),
      )
      .mockResolvedValueOnce(resposta([texto('ok')], 'fim'));
    ferramentas.executar.mockResolvedValueOnce({ conteudo: 'A', erro: false }).mockResolvedValueOnce({ conteudo: 'B', erro: true });

    await service.chat('u1', 'Lucro e mais vendidos do mês');

    const ultima = chat.mock.calls[1][0].mensagens.at(-1)!;
    expect(ultima.papel).toBe('user');
    expect(ultima.blocos).toEqual([
      { tipo: 'resultado', idChamada: 'c1', nome: 'relatorio_lucro', conteudo: 'A', erro: false },
      { tipo: 'resultado', idChamada: 'c2', nome: 'produtos_mais_vendidos', conteudo: 'B', erro: true },
    ]);
  });

  it('expõe as ações sugeridas para o botão de confirmação e as grava com a resposta final', async () => {
    const { service, chat, tx, ferramentas } = montar();
    const acao: AcaoSugerida = {
      id: 'a1',
      tipo: 'REGISTRAR_COMPRA',
      descricao: 'Registrar compra: 12× Malbec',
      requisicao: { metodo: 'POST', caminho: '/api/compras', corpo: { fornecedorId: null, itens: [] } },
      camposPendentes: ['fornecedorId'],
    };
    chat
      .mockResolvedValueOnce(resposta([chamada('c1', 'propor_compra', { itens: [], justificativa: 'x' })], 'ferramentas'))
      .mockResolvedValueOnce(resposta([texto('Preparei a compra; confirme no botão.')], 'fim'));
    ferramentas.executar.mockResolvedValue({ conteudo: '{"status":"aguardando_confirmacao_do_usuario"}', erro: false, acao });

    const r = await service.chat('u1', 'Monte um pedido de Malbec');

    expect(r.acoes).toEqual([acao]);
    expect(tx.mensagem.createMany.mock.calls[0][0].data.at(-1).acoes).toEqual([acao]);
  });

  it('na última iteração permitida proíbe ferramentas para garantir resposta final', async () => {
    const { service, chat, ferramentas } = montar({ config: { maxIteracoes: 2 } });
    chat
      .mockResolvedValueOnce(resposta([chamada('c1', 'estoque_baixo')], 'ferramentas'))
      .mockResolvedValueOnce(resposta([texto('Resumo final')], 'fim'));
    ferramentas.executar.mockResolvedValue({ conteudo: '{}', erro: false });

    await service.chat('u1', 'pergunta');

    expect(chat.mock.calls[0][0].permitirFerramentas).toBe(true);
    expect(chat.mock.calls[1][0].permitirFerramentas).toBe(false);
  });

  it('continua uma conversa existente reenviando o histórico (com o conteúdo nativo) sem alterações', async () => {
    const nativo = { role: 'model', parts: [{ text: 'Olá!', thoughtSignature: 'sig' }] };
    const historico = [
      { ordem: 0, papel: 'user', conteudo: [texto('oi')], nativo: null },
      { ordem: 1, papel: 'assistant', conteudo: [texto('Olá!')], nativo },
    ];
    const { service, chat, tx } = montar({
      conversa: { id: 'c1', provedor: 'gemini', tamanhoContexto: 500, mensagens: historico },
    });
    chat.mockResolvedValueOnce(resposta([texto('...')], 'fim'));

    await service.chat('u1', 'e o lucro?', 'c1');

    expect(chat.mock.calls[0][0].mensagens).toEqual([
      { papel: 'user', blocos: [texto('oi')], nativo: undefined },
      { papel: 'assistant', blocos: [texto('Olá!')], nativo },
      { papel: 'user', blocos: [texto('e o lucro?')] },
    ]);
    expect(tx.conversa.create).not.toHaveBeenCalled();
    expect(tx.mensagem.createMany.mock.calls[0][0].data.map((m: any) => m.ordem)).toEqual([2, 3]);
  });

  it('não mistura provedores: conversa feita com outro provedor pede nova conversa', async () => {
    const { service, chat } = montar({ conversa: { id: 'c1', provedor: 'anthropic', tamanhoContexto: 0, mensagens: [] } });
    await expect(service.chat('u1', 'oi', 'c1')).rejects.toMatchObject({ status: 422 });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('AssistenteService — pergunta fora do escopo', () => {
  it('responde sem chamar ferramentas e o prompt instrui a restringir ao negócio', async () => {
    const { service, chat, ferramentas } = montar();
    chat.mockResolvedValueOnce(
      resposta([texto('Só consigo ajudar com a gestão da adega. Posso, por exemplo, mostrar o lucro do mês.')], 'fim'),
    );

    const r = await service.chat('u1', 'Qual a capital da Austrália?');

    expect(ferramentas.executar).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(r.ferramentasUsadas).toEqual([]);
    expect(r.acoes).toEqual([]);
    expect(r.resposta).toMatch(/gestão da adega/);

    const req = chat.mock.calls[0][0];
    expect(req.sistema).toBe(PROMPT_SISTEMA);
    expect(req.contexto).toMatch(/^Hoje é \d{4}-\d{2}-\d{2}/);
    expect(req.ferramentas.map((f) => f.nome)).toContain('sugerir_reposicao');
    expect(PROMPT_SISTEMA).toMatch(/Responda apenas sobre o negócio da adega/);
    expect(PROMPT_SISTEMA).toMatch(/Nunca estime nem invente valores/);
    expect(PROMPT_SISTEMA).toMatch(/informe sempre o período/);
    expect(PROMPT_SISTEMA).toMatch(/não há dados/);
  });
});

describe('AssistenteService — log e limites', () => {
  it('registra o uso de tokens de cada chamada em log estruturado', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    log.mockClear();
    const { service, chat } = montar();
    chat.mockResolvedValueOnce(resposta([texto('ok')], 'fim', { entrada: 42, saida: 7 }));

    const r = await service.chat('u1', 'oi');

    const linha = JSON.parse(log.mock.calls.find((c) => String(c[0]).includes('assistente.uso_tokens'))![0] as string);
    expect(linha).toMatchObject({ conversaId: r.conversaId, usuarioId: 'u1', iteracao: 1, provedor: 'gemini', entrada: 42, saida: 7 });
  });

  it('marca a resposta como truncada quando bate no limite de tokens', async () => {
    const { service, chat } = montar();
    chat.mockResolvedValueOnce(resposta([texto('Resposta cortad')], 'limite_tokens'));
    expect((await service.chat('u1', 'oi')).truncada).toBe(true);
  });
});

describe('AssistenteService — erros amigáveis', () => {
  const casos: Array<[TipoErroLlm, number, RegExp]> = [
    ['limite_uso', 429, /^Limite de uso do assistente atingido\. Tente novamente em alguns minutos\.$/],
    ['timeout', 504, /demorou demais/],
    ['conexao', 503, /Não foi possível falar/],
    ['credencial', 503, /problema de configuração/],
    ['sem_creditos', 503, /sem créditos/],
    ['indisponivel', 503, /instável/],
    ['requisicao_invalida', 502, /não conseguiu responder/],
  ];

  it.each(casos)('%s → HTTP %i com mensagem em português e nada é gravado', async (tipo, status, mensagem) => {
    const { service, chat, prisma } = montar();
    chat.mockRejectedValueOnce(new LlmErro(tipo, 'detalhe técnico interno: RESOURCE_EXHAUSTED key=abc'));

    const falha = await service.chat('u1', 'oi').catch((e) => e);

    expect(falha).toBeInstanceOf(HttpException);
    expect(falha.getStatus()).toBe(status);
    expect(String(falha.message)).toMatch(mensagem);
    expect(String(falha.message)).not.toMatch(/RESOURCE_EXHAUSTED|key=/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a mensagem do 429 é exatamente a combinada', () => {
    expect(MENSAGEM_LIMITE_USO).toBe('Limite de uso do assistente atingido. Tente novamente em alguns minutos.');
  });

  it('assistente desligado ou sem chave → 503 sem chamar o provedor', async () => {
    const desligado = montar({ config: { habilitado: false } });
    await expect(desligado.service.chat('u1', 'oi')).rejects.toMatchObject({ status: 503 });
    expect(desligado.chat).not.toHaveBeenCalled();

    const semChave = montar({ semProvider: true });
    await expect(semChave.service.chat('u1', 'oi')).rejects.toMatchObject({ status: 503 });
  });

  it('recusa do modelo → 422 e o turno não é gravado', async () => {
    const { service, chat, prisma } = montar();
    chat.mockResolvedValueOnce(resposta([], 'recusa'));
    await expect(service.chat('u1', 'algo indevido')).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('chamada de ferramenta cortada pelo limite de tokens não é executada nem gravada', async () => {
    const { service, chat, prisma, ferramentas } = montar();
    chat.mockResolvedValueOnce(resposta([chamada('c1', 'buscar_produtos')], 'limite_tokens'));
    await expect(service.chat('u1', 'oi')).rejects.toMatchObject({ status: 422 });
    expect(ferramentas.executar).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conversa longa demais → 422 pedindo nova conversa, sem chamar o provedor', async () => {
    const { service, chat } = montar({ conversa: { id: 'c1', provedor: 'gemini', tamanhoContexto: 40_000, mensagens: [] } });
    await expect(service.chat('u1', 'oi', 'c1')).rejects.toMatchObject({ status: 422 });
    expect(chat).not.toHaveBeenCalled();
  });

  it('conversa de outro usuário → 404', async () => {
    const { service } = montar({ conversa: null });
    await expect(service.chat('u1', 'oi', 'c-de-outro')).rejects.toMatchObject({ status: 404 });
  });
});
