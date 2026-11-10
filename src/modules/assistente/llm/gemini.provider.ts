import {
  ApiError,
  Content,
  FinishReason,
  FunctionCallingConfigMode,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingLevel,
} from '@google/genai';
import { randomUUID } from 'crypto';
import { BlocoLlm, LlmErro, LlmProvider, MensagemLlm, MotivoParada, RequisicaoLlm, RespostaLlm } from './llm.types';

/** Só o que o provider usa do cliente — facilita o mock nos testes. */
export type ClienteGemini = Pick<GoogleGenAI, 'models'>;

export interface ConfigGemini {
  modelo: string;
  maxTokens: number;
  /** undefined = padrão do modelo */
  nivelRaciocinio?: ThinkingLevel;
}

/** Ids gerados por nós (quando o Gemini não manda id) não são reenviados à API. */
const PREFIXO_ID_LOCAL = 'local:';

const PARADAS_RECUSA = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

/**
 * Provider do Google Gemini (SDK oficial @google/genai, generateContent sem estado:
 * o histórico é nosso e é reenviado a cada chamada).
 */
export class GeminiProvider implements LlmProvider {
  readonly nome = 'gemini' as const;

  constructor(
    private readonly cliente: ClienteGemini,
    private readonly cfg: ConfigGemini,
  ) {}

  get modelo() {
    return this.cfg.modelo;
  }

  async chat(req: RequisicaoLlm): Promise<RespostaLlm> {
    const config: GenerateContentConfig = {
      // Prompt fixo primeiro e a data no fim: prefixo estável favorece o cache implícito do Gemini
      systemInstruction: `${req.sistema}\n\n${req.contexto}`,
      maxOutputTokens: this.cfg.maxTokens,
      tools: [
        {
          functionDeclarations: req.ferramentas.map((f) => ({
            name: f.nome,
            description: f.descricao,
            parametersJsonSchema: f.parametros,
          })),
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: req.permitirFerramentas ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE,
        },
      },
      ...(this.cfg.nivelRaciocinio ? { thinkingConfig: { thinkingLevel: this.cfg.nivelRaciocinio } } : {}),
    };

    let resposta: GenerateContentResponse;
    try {
      resposta = await this.cliente.models.generateContent({
        model: this.cfg.modelo,
        contents: req.mensagens.map((m) => this.paraContent(m)),
        config,
      });
    } catch (e) {
      throw classificarErroGemini(e);
    }
    return this.deResposta(resposta);
  }

  private paraContent(m: MensagemLlm): Content {
    if (m.papel === 'assistant') {
      // Reenvia o conteúdo original (com thoughtSignature) sem nenhuma alteração
      if (m.nativo) return m.nativo as Content;
      return { role: 'model', parts: m.blocos.map((b) => this.parteAssistente(b)) };
    }
    return { role: 'user', parts: m.blocos.map((b) => this.parteUsuario(b)) };
  }

  private parteAssistente(b: BlocoLlm): Part {
    if (b.tipo === 'texto') return { text: b.texto };
    if (b.tipo === 'chamada') {
      return { functionCall: { ...this.idParaApi(b.id), name: b.nome, args: b.entrada } };
    }
    throw new Error('Resultado de ferramenta não pode estar numa mensagem do assistente');
  }

  private parteUsuario(b: BlocoLlm): Part {
    if (b.tipo === 'texto') return { text: b.texto };
    if (b.tipo === 'resultado') {
      return {
        functionResponse: {
          ...this.idParaApi(b.idChamada),
          name: b.nome,
          response: b.erro ? { error: b.conteudo } : { output: tentarJson(b.conteudo) },
        },
      };
    }
    throw new Error('Chamada de ferramenta não pode estar numa mensagem do usuário');
  }

  private idParaApi(id: string): { id?: string } {
    return id.startsWith(PREFIXO_ID_LOCAL) ? {} : { id };
  }

  private deResposta(r: GenerateContentResponse): RespostaLlm {
    const candidato = r.candidates?.[0];
    const partes = candidato?.content?.parts ?? [];
    const blocos: BlocoLlm[] = [];
    for (const p of partes) {
      if (p.functionCall?.name) {
        blocos.push({
          tipo: 'chamada',
          id: p.functionCall.id ?? `${PREFIXO_ID_LOCAL}${randomUUID()}`,
          nome: p.functionCall.name,
          entrada: p.functionCall.args ?? {},
        });
      } else if (p.text && !p.thought) {
        blocos.push({ tipo: 'texto', texto: p.text });
      }
    }

    let parada: MotivoParada;
    if (!candidato && r.promptFeedback?.blockReason) parada = 'recusa';
    else if (blocos.some((b) => b.tipo === 'chamada')) parada = 'ferramentas';
    else if (candidato?.finishReason === FinishReason.MAX_TOKENS) parada = 'limite_tokens';
    else if (PARADAS_RECUSA.has(candidato?.finishReason)) parada = 'recusa';
    else parada = 'fim';

    const u = r.usageMetadata ?? {};
    const cache = u.cachedContentTokenCount ?? 0;
    return {
      blocos,
      parada,
      uso: {
        // promptTokenCount já inclui a parte em cache; separamos para o log
        entrada: (u.promptTokenCount ?? 0) - cache + (u.toolUsePromptTokenCount ?? 0),
        // raciocínio ("thoughts") é cobrado/limitado como saída
        saida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        cacheLeitura: cache,
        cacheEscrita: 0,
      },
      modelo: r.modelVersion ?? this.cfg.modelo,
      nativo: candidato?.content ?? { role: 'model', parts: [] },
    };
  }
}

function tentarJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/** Converte erros do SDK do Gemini em LlmErro. */
export function classificarErroGemini(e: unknown): LlmErro {
  if (e instanceof LlmErro) return e;
  if (e instanceof ApiError) {
    const s = e.status;
    if (s === 429) return new LlmErro('limite_uso', e.message, s);
    // A API do Gemini responde 400 (não 401) para chave inválida
    if (s === 401 || s === 403 || (s === 400 && /api[ _-]?key/i.test(e.message))) {
      return new LlmErro('credencial', e.message, s);
    }
    if (s === 408 || s === 504) return new LlmErro('timeout', e.message, s);
    if (s >= 500) return new LlmErro('indisponivel', e.message, s);
    if (s >= 400) return new LlmErro('requisicao_invalida', e.message, s);
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return new LlmErro('timeout', e.message);
    if (e.name === 'TypeError' && /fetch failed|network|ECONN|ENOTFOUND/i.test(`${e.message} ${String(e.cause ?? '')}`)) {
      return new LlmErro('conexao', e.message);
    }
    return new LlmErro('desconhecido', e.message);
  }
  return new LlmErro('desconhecido', String(e));
}

export function criarClienteGemini(apiKey: string, timeoutMs: number, maxRetries: number): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    // Sem novas tentativas por padrão: no plano gratuito, repetir após 429 só gasta cota
    httpOptions: { timeout: timeoutMs, retryOptions: { attempts: maxRetries + 1 } },
  });
}
