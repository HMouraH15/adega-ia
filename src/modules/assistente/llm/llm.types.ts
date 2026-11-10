/**
 * Contrato neutro entre o assistente e qualquer provedor de LLM (Gemini, Anthropic…).
 * O AssistenteService só conhece estes tipos; cada provider converte para o formato
 * do seu SDK e de volta.
 */

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export type NomeProvedor = 'gemini' | 'anthropic';

export interface UsoTokens {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export type BlocoLlm =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'chamada'; id: string; nome: string; entrada: Record<string, unknown> }
  | { tipo: 'resultado'; idChamada: string; nome: string; conteudo: string; erro: boolean };

export interface MensagemLlm {
  papel: 'user' | 'assistant';
  blocos: BlocoLlm[];
  /**
   * Conteúdo exatamente como o provedor devolveu (só em mensagens do assistente).
   * É reenviado sem alteração: Gemini exige as "thought signatures" e o Claude os
   * blocos de raciocínio do jeito que vieram.
   */
  nativo?: unknown;
}

export interface FerramentaLlm {
  nome: string;
  descricao: string;
  /** JSON Schema dos parâmetros */
  parametros: Record<string, unknown>;
}

export interface RequisicaoLlm {
  /** Prompt de sistema fixo (cacheável) */
  sistema: string;
  /** Contexto variável (data de hoje), enviado depois do prompt fixo */
  contexto: string;
  mensagens: MensagemLlm[];
  ferramentas: FerramentaLlm[];
  /** false = o modelo deve responder só com texto (última iteração) */
  permitirFerramentas: boolean;
}

export type MotivoParada = 'fim' | 'ferramentas' | 'limite_tokens' | 'recusa';

export interface RespostaLlm {
  /** Só blocos 'texto' e 'chamada' */
  blocos: BlocoLlm[];
  parada: MotivoParada;
  uso: UsoTokens;
  modelo: string;
  nativo: unknown;
}

export interface LlmProvider {
  readonly nome: NomeProvedor;
  readonly modelo: string;
  chat(req: RequisicaoLlm): Promise<RespostaLlm>;
}

export type TipoErroLlm =
  | 'limite_uso'
  | 'timeout'
  | 'conexao'
  | 'credencial'
  | 'sem_creditos'
  | 'indisponivel'
  | 'requisicao_invalida'
  | 'desconhecido';

/** Erro de provedor já classificado; o service converte em resposta HTTP amigável. */
export class LlmErro extends Error {
  constructor(
    public readonly tipo: TipoErroLlm,
    mensagemTecnica: string,
    public readonly status?: number,
  ) {
    super(mensagemTecnica);
    this.name = 'LlmErro';
  }
}
