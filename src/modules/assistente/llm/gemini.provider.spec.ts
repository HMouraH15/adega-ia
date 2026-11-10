import { ApiError, FinishReason, FunctionCallingConfigMode, ThinkingLevel } from '@google/genai';
import { DEFINICOES_FERRAMENTAS } from '../ferramentas';
import { classificarErroGemini, ClienteGemini, GeminiProvider } from './gemini.provider';
import { LlmErro, RequisicaoLlm } from './llm.types';

/** Nenhum teste chama a API real: o cliente do Gemini é um mock. */
function montar() {
  const generateContent = jest.fn();
  const cliente = { models: { generateContent } } as unknown as ClienteGemini;
  const provider = new GeminiProvider(cliente, {
    modelo: 'gemini-3.8-flash',
    maxTokens: 2048,
    nivelRaciocinio: ThinkingLevel.LOW,
  });
  return { provider, generateContent };
}

const req = (over: Partial<RequisicaoLlm> = {}): RequisicaoLlm => ({
  sistema: 'PROMPT FIXO',
  contexto: 'Hoje é 2026-11-10',
  mensagens: [{ papel: 'user', blocos: [{ tipo: 'texto', texto: 'O que repor?' }] }],
  ferramentas: DEFINICOES_FERRAMENTAS,
  permitirFerramentas: true,
  ...over,
});

const respostaGemini = (parts: object[], finishReason = FinishReason.STOP, usage: object = {}) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 30, cachedContentTokenCount: 600, ...usage },
  modelVersion: 'gemini-3.8-flash',
});

describe('GeminiProvider', () => {
  it('monta a requisição: prompt de sistema, ferramentas em JSON Schema, modo AUTO e raciocínio LOW', async () => {
    const { provider, generateContent } = montar();
    generateContent.mockResolvedValue(respostaGemini([{ text: 'ok' }]));

    await provider.chat(req());

    const p = generateContent.mock.calls[0][0];
    expect(p.model).toBe('gemini-3.8-flash');
    expect(p.contents).toEqual([{ role: 'user', parts: [{ text: 'O que repor?' }] }]);
    expect(p.config.systemInstruction).toBe('PROMPT FIXO\n\nHoje é 2026-11-10');
    expect(p.config.maxOutputTokens).toBe(2048);
    expect(p.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(p.config.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    const declaracoes = p.config.tools[0].functionDeclarations;
    expect(declaracoes).toHaveLength(DEFINICOES_FERRAMENTAS.length);
    expect(declaracoes[0]).toEqual({
      name: 'buscar_produtos',
      description: DEFINICOES_FERRAMENTAS[0].descricao,
      parametersJsonSchema: DEFINICOES_FERRAMENTAS[0].parametros,
    });
  });

  it('proíbe ferramentas com o modo NONE quando permitirFerramentas = false', async () => {
    const { provider, generateContent } = montar();
    generateContent.mockResolvedValue(respostaGemini([{ text: 'ok' }]));
    await provider.chat(req({ permitirFerramentas: false }));
    expect(generateContent.mock.calls[0][0].config.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.NONE);
  });

  it('converte chamadas de função, ignora "thoughts" e devolve o conteúdo nativo intacto', async () => {
    const { provider, generateContent } = montar();
    const parts = [
      { text: 'pensando…', thought: true },
      { functionCall: { id: 'fc-1', name: 'estoque_baixo', args: {} }, thoughtSignature: 'SIG-1' },
      { functionCall: { name: 'relatorio_lucro', args: { inicio: '2026-11-01', fim: '2026-11-10' } } },
    ];
    generateContent.mockResolvedValue(respostaGemini(parts));

    const r = await provider.chat(req());

    expect(r.parada).toBe('ferramentas');
    expect(r.blocos[0]).toEqual({ tipo: 'chamada', id: 'fc-1', nome: 'estoque_baixo', entrada: {} });
    expect(r.blocos[1]).toMatchObject({ tipo: 'chamada', nome: 'relatorio_lucro', entrada: { inicio: '2026-11-01', fim: '2026-11-10' } });
    expect((r.blocos[1] as { id: string }).id).toMatch(/^local:/); // sem id do Gemini → id local
    expect(r.nativo).toEqual({ role: 'model', parts }); // com a thought signature
    expect(r.uso).toEqual({ entrada: 400, saida: 80, cacheLeitura: 600, cacheEscrita: 0 });
  });

  it('reenvia o turno do modelo exatamente como veio (thought signature) e devolve os resultados como functionResponse', async () => {
    const { provider, generateContent } = montar();
    generateContent.mockResolvedValue(respostaGemini([{ text: 'Resposta final' }]));
    const nativo = {
      role: 'model',
      parts: [
        { functionCall: { id: 'fc-1', name: 'estoque_baixo', args: {} }, thoughtSignature: 'SIG-1' },
        { functionCall: { name: 'buscar_produtos', args: { termo: 'gin' } } },
      ],
    };

    await provider.chat(
      req({
        mensagens: [
          { papel: 'user', blocos: [{ tipo: 'texto', texto: 'pergunta' }] },
          {
            papel: 'assistant',
            blocos: [
              { tipo: 'chamada', id: 'fc-1', nome: 'estoque_baixo', entrada: {} },
              { tipo: 'chamada', id: 'local:abc', nome: 'buscar_produtos', entrada: { termo: 'gin' } },
            ],
            nativo,
          },
          {
            papel: 'user',
            blocos: [
              { tipo: 'resultado', idChamada: 'fc-1', nome: 'estoque_baixo', conteudo: '{"semDados":true}', erro: false },
              { tipo: 'resultado', idChamada: 'local:abc', nome: 'buscar_produtos', conteudo: 'Parâmetros inválidos', erro: true },
            ],
          },
        ],
      }),
    );

    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents[1]).toBe(nativo);
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { id: 'fc-1', name: 'estoque_baixo', response: { output: { semDados: true } } } },
        // id local não é enviado à API
        { functionResponse: { name: 'buscar_produtos', response: { error: 'Parâmetros inválidos' } } },
      ],
    });
  });

  it.each([
    [FinishReason.MAX_TOKENS, 'limite_tokens'],
    [FinishReason.SAFETY, 'recusa'],
    [FinishReason.PROHIBITED_CONTENT, 'recusa'],
    [FinishReason.STOP, 'fim'],
  ])('finishReason %s → parada %s', async (finishReason, parada) => {
    const { provider, generateContent } = montar();
    generateContent.mockResolvedValue(respostaGemini([{ text: 'x' }], finishReason));
    expect((await provider.chat(req())).parada).toBe(parada);
  });

  it('prompt bloqueado (sem candidatos) → recusa', async () => {
    const { provider, generateContent } = montar();
    generateContent.mockResolvedValue({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } });
    expect((await provider.chat(req())).parada).toBe('recusa');
  });

  it('429 do plano gratuito vira LlmErro "limite_uso"', async () => {
    const { provider, generateContent } = montar();
    generateContent.mockRejectedValue(new ApiError({ status: 429, message: 'RESOURCE_EXHAUSTED: quota exceeded' }));
    await expect(provider.chat(req())).rejects.toMatchObject({ tipo: 'limite_uso', status: 429 });
  });
});

describe('classificarErroGemini', () => {
  it.each([
    [new ApiError({ status: 429, message: 'quota' }), 'limite_uso'],
    [new ApiError({ status: 400, message: 'API key not valid. Please pass a valid API key.' }), 'credencial'],
    [new ApiError({ status: 403, message: 'permission denied' }), 'credencial'],
    [new ApiError({ status: 400, message: 'Invalid JSON payload' }), 'requisicao_invalida'],
    [new ApiError({ status: 503, message: 'overloaded' }), 'indisponivel'],
    [new ApiError({ status: 504, message: 'deadline' }), 'timeout'],
    [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new TypeError('fetch failed'), {}), 'conexao'],
    [new Error('???'), 'desconhecido'],
  ])('%s → %s', (erro, tipo) => {
    const r = classificarErroGemini(erro);
    expect(r).toBeInstanceOf(LlmErro);
    expect(r.tipo).toBe(tipo);
  });
});
