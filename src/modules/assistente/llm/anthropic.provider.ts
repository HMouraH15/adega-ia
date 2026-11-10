import Anthropic from '@anthropic-ai/sdk';
import { BlocoLlm, LlmErro, LlmProvider, MensagemLlm, MotivoParada, RequisicaoLlm, RespostaLlm } from './llm.types';

export type ClienteAnthropic = Pick<Anthropic, 'messages'>;

export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ConfigAnthropic {
  modelo: string;
  maxTokens: number;
  /** undefined = padrão do modelo */
  esforco?: Esforco;
}

/** Provider da Anthropic (Claude), via SDK oficial @anthropic-ai/sdk. */
export class AnthropicProvider implements LlmProvider {
  readonly nome = 'anthropic' as const;

  constructor(
    private readonly cliente: ClienteAnthropic,
    private readonly cfg: ConfigAnthropic,
  ) {}

  get modelo() {
    return this.cfg.modelo;
  }

  async chat(req: RequisicaoLlm): Promise<RespostaLlm> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.cfg.modelo,
      max_tokens: this.cfg.maxTokens,
      // Bloco fixo com breakpoint de cache (cacheia ferramentas + prompt); a data vem depois
      system: [
        { type: 'text', text: req.sistema, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: req.contexto },
      ],
      tools: req.ferramentas.map((f) => ({
        name: f.nome,
        description: f.descricao,
        input_schema: f.parametros as Anthropic.Tool.InputSchema,
      })),
      messages: req.mensagens.map((m) => this.paraMessageParam(m)),
      // Cache automático do histórico: barateia os ciclos de ferramenta e as perguntas seguintes
      cache_control: { type: 'ephemeral' },
      ...(this.cfg.esforco ? { output_config: { effort: this.cfg.esforco } } : {}),
      ...(req.permitirFerramentas ? {} : { tool_choice: { type: 'none' } }),
    };

    let r: Anthropic.Message;
    try {
      r = await this.cliente.messages.create(params);
    } catch (e) {
      throw classificarErroAnthropic(e);
    }

    const blocos: BlocoLlm[] = [];
    for (const b of r.content) {
      if (b.type === 'text') blocos.push({ tipo: 'texto', texto: b.text });
      else if (b.type === 'tool_use') {
        blocos.push({ tipo: 'chamada', id: b.id, nome: b.name, entrada: (b.input ?? {}) as Record<string, unknown> });
      }
    }
    const paradas: Partial<Record<string, MotivoParada>> = {
      tool_use: 'ferramentas',
      max_tokens: 'limite_tokens',
      refusal: 'recusa',
    };
    const u = r.usage;
    return {
      blocos,
      parada: paradas[r.stop_reason ?? ''] ?? 'fim',
      uso: {
        entrada: u.input_tokens ?? 0,
        saida: u.output_tokens ?? 0,
        cacheLeitura: u.cache_read_input_tokens ?? 0,
        cacheEscrita: u.cache_creation_input_tokens ?? 0,
      },
      modelo: r.model,
      // Conteúdo original (inclui blocos de raciocínio), reenviado sem alteração
      nativo: r.content,
    };
  }

  private paraMessageParam(m: MensagemLlm): Anthropic.MessageParam {
    if (m.papel === 'assistant') {
      if (m.nativo) return { role: 'assistant', content: m.nativo as Anthropic.ContentBlockParam[] };
      return {
        role: 'assistant',
        content: m.blocos.map((b): Anthropic.ContentBlockParam => {
          if (b.tipo === 'texto') return { type: 'text', text: b.texto };
          if (b.tipo === 'chamada') return { type: 'tool_use', id: b.id, name: b.nome, input: b.entrada };
          throw new Error('Resultado de ferramenta não pode estar numa mensagem do assistente');
        }),
      };
    }
    if (m.blocos.length === 1 && m.blocos[0].tipo === 'texto') return { role: 'user', content: m.blocos[0].texto };
    return {
      role: 'user',
      content: m.blocos.map((b): Anthropic.ContentBlockParam => {
        if (b.tipo === 'texto') return { type: 'text', text: b.texto };
        if (b.tipo === 'resultado') {
          return { type: 'tool_result', tool_use_id: b.idChamada, content: b.conteudo, ...(b.erro ? { is_error: true } : {}) };
        }
        throw new Error('Chamada de ferramenta não pode estar numa mensagem do usuário');
      }),
    };
  }
}

/** Converte erros do SDK da Anthropic em LlmErro; do mais específico para o mais genérico. */
export function classificarErroAnthropic(e: unknown): LlmErro {
  if (e instanceof LlmErro) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LlmErro('timeout', e.message);
  if (e instanceof Anthropic.APIConnectionError) return new LlmErro('conexao', e.message);
  if (e instanceof Anthropic.RateLimitError) return new LlmErro('limite_uso', e.message, 429);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new LlmErro('credencial', e.message, e.status);
  }
  if (e instanceof Anthropic.APIError && e.status === 402) return new LlmErro('sem_creditos', e.message, 402);
  if (e instanceof Anthropic.InternalServerError) return new LlmErro('indisponivel', e.message, e.status);
  if (e instanceof Anthropic.APIError) return new LlmErro('requisicao_invalida', e.message, e.status);
  return new LlmErro('desconhecido', e instanceof Error ? e.message : String(e));
}
