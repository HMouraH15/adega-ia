const OBRIGATORIAS = ['DATABASE_URL', 'JWT_SECRET'] as const;

const INTEIRAS_POSITIVAS = ['PORT'] as const;

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
  if (config.FUSO_HORARIO !== undefined && !/^[+-]\d{2}:\d{2}$/.test(String(config.FUSO_HORARIO))) {
    erros.push('FUSO_HORARIO deve estar no formato ±HH:MM (ex.: -03:00)');
  }

  if (erros.length) {
    throw new Error(`Configuração inválida:\n- ${erros.join('\n- ')}`);
  }
  return config;
}
