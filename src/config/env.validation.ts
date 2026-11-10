const OBRIGATORIAS = ['DATABASE_URL', 'JWT_SECRET'] as const;

const INTEIRAS_POSITIVAS = [
  'PORT',
  'LLM_MAX_TOKENS',
  'LLM_TIMEOUT_MS',
  'ASSISTENTE_MAX_ITERACOES',
  'ASSISTENTE_MAX_TOKENS_CONTEXTO',
  'ASSISTENTE_RATE_LIMIT',
  'ASSISTENTE_RATE_TTL_MS',
] as const;

const ESFORCOS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const PROVEDORES = ['gemini', 'anthropic'];
const NIVEIS_GEMINI = ['', 'LOW', 'MEDIUM', 'HIGH'];

/** Valida variáveis de ambiente na inicialização; falha cedo com mensagem clara. */
export function validarAmbiente(config: Record<string, unknown>): Record<string, unknown> {
  const erros: string[] = [];

  for (const chave of OBRIGATORIAS) {
    if (!config[chave]) erros.push(`${chave} é obrigatória`);
  }
  if (typeof config.JWT_SECRET === 'string' && config.JWT_SECRET.length < 16) {
    erros.push('JWT_SECRET deve ter ao menos 16 caracteres');
  }
  for (const chave of INTEIRAS_POSITIVAS) {
    const valor = config[chave];
    if (valor !== undefined && valor !== '' && !(Number.isInteger(Number(valor)) && Number(valor) > 0)) {
      erros.push(`${chave} deve ser um inteiro positivo`);
    }
  }
  const retries = config.LLM_MAX_RETRIES;
  if (retries !== undefined && retries !== '' && !(Number.isInteger(Number(retries)) && Number(retries) >= 0)) {
    erros.push('LLM_MAX_RETRIES deve ser um inteiro >= 0');
  }
  if (config.LLM_PROVIDER !== undefined && config.LLM_PROVIDER !== '' && !PROVEDORES.includes(String(config.LLM_PROVIDER).toLowerCase())) {
    erros.push(`LLM_PROVIDER deve ser um de: ${PROVEDORES.join(', ')}`);
  }
  if (config.GEMINI_THINKING_LEVEL !== undefined && !NIVEIS_GEMINI.includes(String(config.GEMINI_THINKING_LEVEL).toUpperCase())) {
    erros.push('GEMINI_THINKING_LEVEL deve ser LOW, MEDIUM, HIGH (ou vazio)');
  }
  if (config.ANTHROPIC_EFFORT !== undefined && !ESFORCOS.includes(String(config.ANTHROPIC_EFFORT))) {
    erros.push(`ANTHROPIC_EFFORT deve ser um de: ${ESFORCOS.filter(Boolean).join(', ')} (ou vazio)`);
  }
  if (config.FUSO_HORARIO !== undefined && !/^[+-]\d{2}:\d{2}$/.test(String(config.FUSO_HORARIO))) {
    erros.push('FUSO_HORARIO deve estar no formato ±HH:MM (ex.: -03:00)');
  }

  if (erros.length) {
    throw new Error(`Configuração inválida:\n- ${erros.join('\n- ')}`);
  }
  return config;
}
