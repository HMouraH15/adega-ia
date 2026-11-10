import { Logger } from '@nestjs/common';

/**
 * Proteção de dados pessoais no que é enviado ao modelo de IA.
 *
 * As ferramentas do assistente só podem devolver dados de produtos, estoque,
 * vendas e valores agregados. Isto é garantido de duas formas:
 *  1. LISTA DE CAMPOS PERMITIDOS: qualquer chave fora da lista é descartada
 *     (e registrada em log). Uma ferramenta nova que tente devolver e-mail,
 *     telefone, endereço, documento, usuário etc. não vaza nada — o campo some.
 *  2. MASCARAMENTO DE PADRÕES: e-mails, telefones, CPF/CNPJ e CEPs que apareçam
 *     dentro de textos livres (ex.: digitados no nome de um produto) são trocados
 *     por "[removido]".
 *
 * Importante: no plano gratuito da API do Gemini, o Google pode usar o conteúdo
 * enviado para melhorar os produtos dele. Por isso nada pessoal deve sair daqui.
 */
export const CAMPOS_PERMITIDOS: ReadonlySet<string> = new Set([
  // produtos e estoque
  'produtos', 'produto', 'produtoId', 'id', 'nome', 'categoria', 'custo', 'venda', 'margemPct',
  'estoque', 'minimo', 'estoqueAtual', 'estoqueMinimo',
  // períodos
  'periodo', 'periodoHistorico', 'inicio', 'fim', 'dias', 'agrupamento', 'grupo', 'criterio',
  // vendas e valores agregados
  'semDados', 'semVendasNoPeriodo', 'quantidadeVendas', 'totalVendas', 'vendas', 'receita', 'lucro',
  'margemPercentual', 'series', 'ranking', 'posicao', 'quantidade',
  // reposição
  'sugestoes', 'diasCobertura', 'vendidoNoPeriodo', 'mediaDiaria', 'diasRestantes', 'quantidadeSugerida',
  'precisaRepor', 'custoEstimado',
  // preço
  'custoAtual', 'precoVendaAtual', 'margemAtualPercentual', 'precoSugerido', 'margemDesejadaPercentual',
  'margemResultantePercentual', 'markupPercentual', 'precoAtual', 'precoProposto', 'margemResultantePct',
  // propostas de ação (sem dados de fornecedor/usuário)
  'status', 'acaoId', 'totalEstimado', 'fornecedorPendente', 'observacao',
]);

const PADROES_PESSOAIS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // e-mail
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, // CNPJ
  /\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, // telefone BR
  /\b\d{5}-\d{3}\b/g, // CEP
];

const logger = new Logger('PrivacidadeAssistente');

export function mascararPadroesPessoais(texto: string): string {
  return PADROES_PESSOAIS.reduce((t, re) => t.replace(re, '[removido]'), texto);
}

/** Devolve uma cópia contendo só campos permitidos e textos mascarados. */
export function protegerDadosPessoais<T>(valor: T, caminho = ''): T {
  if (typeof valor === 'string') return mascararPadroesPessoais(valor) as T;
  if (Array.isArray(valor)) return valor.map((v, i) => protegerDadosPessoais(v, `${caminho}[${i}]`)) as T;
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor)) {
      if (!CAMPOS_PERMITIDOS.has(chave)) {
        logger.warn(`Campo "${caminho}${chave}" removido antes de enviar ao modelo (fora da lista permitida)`);
        continue;
      }
      saida[chave] = protegerDadosPessoais(v, `${caminho}${chave}.`);
    }
    return saida as T;
  }
  return valor;
}
