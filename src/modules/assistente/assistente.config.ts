import Anthropic from '@anthropic-ai/sdk';
import { ThinkingLevel } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider, Esforco } from './llm/anthropic.provider';
import { criarClienteGemini, GeminiProvider } from './llm/gemini.provider';
import { LlmProvider, NomeProvedor } from './llm/llm.types';

export const CONFIG_ASSISTENTE = Symbol('CONFIG_ASSISTENTE');

export interface ConfigAssistente {
  habilitado: boolean;
  provedor: NomeProvedor;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  maxIteracoes: number;
  maxTokensContexto: number;
  fuso: string;
  gemini: { apiKey: string; modelo: string; nivelRaciocinio?: ThinkingLevel };
  anthropic: { apiKey: string; modelo: string; esforco?: Esforco };
}

export const PROVEDORES: NomeProvedor[] = ['gemini', 'anthropic'];
export const NIVEIS_RACIOCINIO_GEMINI = ['LOW', 'MEDIUM', 'HIGH'];

export function lerConfigAssistente(c: ConfigService): ConfigAssistente {
  const num = (chave: string, padrao: number) => {
    const v = c.get<string>(chave);
    return v === undefined || v === '' ? padrao : Number(v);
  };
  const texto = (chave: string, padrao = '') => (c.get<string>(chave) ?? padrao).trim();
  const nivel = texto('GEMINI_THINKING_LEVEL', 'LOW').toUpperCase();
  const esforco = texto('ANTHROPIC_EFFORT', 'low');
  return {
    habilitado: texto('ASSISTENTE_HABILITADO', 'true') !== 'false',
    provedor: (texto('LLM_PROVIDER', 'gemini').toLowerCase() || 'gemini') as NomeProvedor,
    maxTokens: num('LLM_MAX_TOKENS', 2048),
    timeoutMs: num('LLM_TIMEOUT_MS', 30_000),
    maxRetries: num('LLM_MAX_RETRIES', 0),
    maxIteracoes: Math.max(2, num('ASSISTENTE_MAX_ITERACOES', 4)),
    maxTokensContexto: num('ASSISTENTE_MAX_TOKENS_CONTEXTO', 30_000),
    fuso: texto('FUSO_HORARIO', '-03:00'),
    gemini: {
      apiKey: texto('GEMINI_API_KEY'),
      // Linha Flash, disponível no plano gratuito da API do Gemini
      modelo: texto('GEMINI_MODEL') || 'gemini-3.8-flash',
      nivelRaciocinio: nivel ? (nivel as ThinkingLevel) : undefined,
    },
    anthropic: {
      apiKey: texto('ANTHROPIC_API_KEY'),
      modelo: texto('ANTHROPIC_MODEL') || 'claude-haiku-5-5',
      esforco: esforco ? (esforco as Esforco) : undefined,
    },
  };
}

/** Cria o provider escolhido em LLM_PROVIDER, ou null se desligado ou sem chave. */
export function criarProvedorLlm(cfg: ConfigAssistente): LlmProvider | null {
  if (!cfg.habilitado) return null;
  if (cfg.provedor === 'anthropic') {
    if (!cfg.anthropic.apiKey) return null;
    const cliente = new Anthropic({ apiKey: cfg.anthropic.apiKey, timeout: cfg.timeoutMs, maxRetries: cfg.maxRetries });
    return new AnthropicProvider(cliente, { modelo: cfg.anthropic.modelo, maxTokens: cfg.maxTokens, esforco: cfg.anthropic.esforco });
  }
  if (!cfg.gemini.apiKey) return null;
  return new GeminiProvider(criarClienteGemini(cfg.gemini.apiKey, cfg.timeoutMs, cfg.maxRetries), {
    modelo: cfg.gemini.modelo,
    maxTokens: cfg.maxTokens,
    nivelRaciocinio: cfg.gemini.nivelRaciocinio,
  });
}
