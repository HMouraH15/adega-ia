import Anthropic from '@anthropic-ai/sdk';
import { DEFINICOES_FERRAMENTAS } from '../ferramentas';
import { AnthropicProvider, classificarErroAnthropic, ClienteAnthropic } from './anthropic.provider';
import { RequisicaoLlm } from './llm.types';

/** Nenhum teste chama a API real: o cliente da Anthropic é um mock. */
function montar() {
  const create = jest.fn();
  const provider = new AnthropicProvider({ messages: { create } } as unknown as ClienteAnthropic, {
    modelo: 'claude-haiku-5-5',
    maxTokens: 1024,
    esforco: 'low',
  });
  return { provider, create };
}

const req = (over: Partial<RequisicaoLlm> = {}): RequisicaoLlm => ({
  sistema: 'PROMPT FIXO',
  contexto: 'Hoje é 2026-11-10',
  mensagens: [{ papel: 'user', blocos: [{ tipo: 'texto', texto: 'oi' }] }],
  ferramentas: DEFINICOES_FERRAMENTAS,
  permitirFerramentas: true,
  ...over,
});

const msg = (content: unknown[], stop_reason: string) => ({
  model: 'claude-haiku-5-5',
  content,
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
});

describe('AnthropicProvider', () => {
  it('monta a requisição com cache, esforço e ferramentas', async () => {
    const { provider, create } = montar();
    create.mockResolvedValue(msg([{ type: 'text', text: 'ok' }], 'end_turn'));
    await provider.chat(req());

    const p = create.mock.calls[0][0];
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.system[0]).toEqual({ type: 'text', text: 'PROMPT FIXO', cache_control: { type: 'ephemeral' } });
    expect(p.system[1].text).toBe('Hoje é 2026-11-10');
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.tool_choice).toBeUndefined();
    expect(p.tools[0]).toEqual({
      name: 'buscar_produtos',
      description: DEFINICOES_FERRAMENTAS[0].descricao,
      input_schema: DEFINICOES_FERRAMENTAS[0].parametros,
    });
    expect(p.messages).toEqual([{ role: 'user', content: 'oi' }]);
  });

  it('converte tool_use e resultados, reenviando o conteúdo nativo do assistente', async () => {
    const { provider, create } = montar();
    const nativo = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'estoque_baixo', input: {} }];
    create.mockResolvedValue(msg([{ type: 'text', text: 'fim' }], 'end_turn'));

    await provider.chat(
      req({
        permitirFerramentas: false,
        mensagens: [
          { papel: 'user', blocos: [{ tipo: 'texto', texto: 'oi' }] },
          { papel: 'assistant', blocos: [{ tipo: 'chamada', id: 't1', nome: 'estoque_baixo', entrada: {} }], nativo },
          { papel: 'user', blocos: [{ tipo: 'resultado', idChamada: 't1', nome: 'estoque_baixo', conteudo: 'X', erro: true }] },
        ],
      }),
    );

    const p = create.mock.calls[0][0];
    expect(p.tool_choice).toEqual({ type: 'none' });
    expect(p.messages[1]).toEqual({ role: 'assistant', content: nativo });
    expect(p.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'X', is_error: true }] });
  });

  it('converte a resposta: blocos, parada e uso', async () => {
    const { provider, create } = montar();
    create.mockResolvedValue(msg([{ type: 'tool_use', id: 't9', name: 'estoque_baixo', input: {} }], 'tool_use'));
    const r = await provider.chat(req());
    expect(r.blocos).toEqual([{ tipo: 'chamada', id: 't9', nome: 'estoque_baixo', entrada: {} }]);
    expect(r.parada).toBe('ferramentas');
    expect(r.uso).toEqual({ entrada: 10, saida: 5, cacheLeitura: 100, cacheEscrita: 0 });
  });
});

describe('classificarErroAnthropic', () => {
  it.each([
    [new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()), 'limite_uso'],
    [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    [new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'conexao'],
    [new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()), 'credencial'],
    [new Anthropic.APIError(402, {}, 'billing', new Headers()), 'sem_creditos'],
    [new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()), 'indisponivel'],
    [new Anthropic.BadRequestError(400, {}, 'bad', new Headers()), 'requisicao_invalida'],
  ])('%s → %s', (erro, tipo) => {
    expect(classificarErroAnthropic(erro).tipo).toBe(tipo);
  });
});
