import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_ASSISTENTE, ConfigAssistente } from './assistente.config';
import { contextoDoDia, PROMPT_SISTEMA } from './assistente.prompt';
import { AcaoSugerida, DEFINICOES_FERRAMENTAS, FerramentasAssistente } from './ferramentas';
import { BlocoLlm, LLM_PROVIDER, LlmErro, LlmProvider, MensagemLlm, RespostaLlm, UsoTokens } from './llm/llm.types';

export type { UsoTokens } from './llm/llm.types';

export interface RespostaChat {
  conversaId: string;
  resposta: string;
  acoes: AcaoSugerida[];
  ferramentasUsadas: string[];
  /** true quando a resposta foi cortada pelo limite de tokens */
  truncada: boolean;
  provedor: string;
  uso: UsoTokens & { chamadas: number };
}

interface MensagemNova extends MensagemLlm {
  acoes?: AcaoSugerida[];
  uso?: UsoTokens;
}

export const MENSAGEM_LIMITE_USO = 'Limite de uso do assistente atingido. Tente novamente em alguns minutos.';

const zero = (): UsoTokens => ({ entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });

@Injectable()
export class AssistenteService {
  private readonly logger = new Logger(AssistenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ferramentas: FerramentasAssistente,
    @Inject(CONFIG_ASSISTENTE) private readonly cfg: ConfigAssistente,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider | null,
  ) {}

  /**
   * Um turno de conversa: envia a pergunta, executa as ferramentas pedidas pelo
   * modelo (somente leitura) e repete até a resposta final. O turno inteiro é
   * gravado de uma vez no fim; se algo falhar no meio, nada é gravado e o
   * histórico continua consistente.
   */
  async chat(usuarioId: string, mensagem: string, conversaId?: string): Promise<RespostaChat> {
    const llm = this.provedorOuErro();
    const conversa = conversaId ? await this.carregarConversa(conversaId, usuarioId) : null;
    if (conversa && conversa.provedor !== llm.nome) {
      throw new UnprocessableEntityException(
        'Esta conversa foi feita com outro provedor de IA. Inicie uma nova conversa para continuar.',
      );
    }
    if (conversa && conversa.tamanhoContexto > this.cfg.maxTokensContexto) {
      throw new UnprocessableEntityException('Esta conversa ficou longa demais. Inicie uma nova conversa para continuar.');
    }

    const id = conversa?.id ?? randomUUID();
    const mensagens: MensagemLlm[] = (conversa?.mensagens ?? []).map((m) => ({
      papel: m.papel as 'user' | 'assistant',
      blocos: m.conteudo as unknown as BlocoLlm[],
      nativo: m.nativo ?? undefined,
    }));
    const pergunta: MensagemNova = { papel: 'user', blocos: [{ tipo: 'texto', texto: mensagem }] };
    const novas: MensagemNova[] = [pergunta];
    mensagens.push(pergunta);

    const acoes: AcaoSugerida[] = [];
    const ferramentasUsadas: string[] = [];
    const total = zero();
    let chamadas = 0;
    let ultima: RespostaLlm | undefined;
    let tamanhoContexto = 0;

    for (let i = 0; i < this.cfg.maxIteracoes; i++) {
      // Na última iteração permitida, proíbe ferramentas para forçar uma resposta final
      const resposta = await this.chamarModelo(llm, mensagens, i < this.cfg.maxIteracoes - 1);
      chamadas++;
      this.somar(total, resposta.uso);
      tamanhoContexto = resposta.uso.entrada + resposta.uso.cacheLeitura + resposta.uso.cacheEscrita;
      this.registrarUso(id, usuarioId, i + 1, llm, resposta);
      ultima = resposta;

      if (resposta.parada === 'recusa') {
        throw new UnprocessableEntityException('Não posso ajudar com esse pedido. Pergunte algo sobre a gestão da adega.');
      }
      const chamadasFerramenta = resposta.blocos.filter(
        (b): b is Extract<BlocoLlm, { tipo: 'chamada' }> => b.tipo === 'chamada',
      );
      if (resposta.parada === 'limite_tokens' && chamadasFerramenta.length) {
        // Chamada de ferramenta cortada no meio: não executa nem grava um histórico quebrado
        throw new UnprocessableEntityException('A resposta ficou grande demais. Tente uma pergunta mais específica.');
      }

      const doAssistente: MensagemNova = { papel: 'assistant', blocos: resposta.blocos, nativo: resposta.nativo, uso: resposta.uso };
      mensagens.push(doAssistente);
      novas.push(doAssistente);

      if (resposta.parada !== 'ferramentas' || !chamadasFerramenta.length) break;

      // Executa as ferramentas em paralelo e devolve TODOS os resultados numa única mensagem
      const resultados = await Promise.all(chamadasFerramenta.map((c) => this.ferramentas.executar(c.nome, c.entrada)));
      const blocos: BlocoLlm[] = chamadasFerramenta.map((c, idx) => {
        ferramentasUsadas.push(c.nome);
        const r = resultados[idx];
        if (r.acao) acoes.push(r.acao);
        return { tipo: 'resultado', idChamada: c.id, nome: c.nome, conteudo: r.conteudo, erro: r.erro };
      });
      const resultadoMsg: MensagemNova = { papel: 'user', blocos };
      mensagens.push(resultadoMsg);
      novas.push(resultadoMsg);
    }

    if (!ultima || ultima.blocos.some((b) => b.tipo === 'chamada')) {
      throw new UnprocessableEntityException('O assistente não conseguiu concluir a resposta. Tente reformular a pergunta.');
    }

    const resposta = ultima.blocos
      .flatMap((b) => (b.tipo === 'texto' ? [b.texto] : []))
      .join('\n')
      .trim();

    // Ações ficam junto da mensagem final do assistente, para reexibir os botões no histórico
    if (acoes.length) novas[novas.length - 1].acoes = acoes;
    await this.gravarTurno(id, usuarioId, mensagem, conversa ? conversa.mensagens.length : null, llm, novas, total, chamadas, tamanhoContexto);

    return {
      conversaId: id,
      resposta: resposta || 'Não consegui formular uma resposta. Tente reformular a pergunta.',
      acoes,
      ferramentasUsadas,
      truncada: ultima.parada === 'limite_tokens',
      provedor: llm.nome,
      uso: { ...total, chamadas },
    };
  }

  async listarConversas(usuarioId: string) {
    return this.prisma.conversa.findMany({
      where: { usuarioId },
      orderBy: { atualizadoEm: 'desc' },
      take: 50,
      select: {
        id: true,
        titulo: true,
        provedor: true,
        modelo: true,
        criadoEm: true,
        atualizadoEm: true,
        tokensEntrada: true,
        tokensSaida: true,
        tokensCacheLeitura: true,
        tokensCacheEscrita: true,
        chamadasModelo: true,
      },
    });
  }

  /** Histórico legível: só os textos do usuário e do assistente, com as ações sugeridas. */
  async obterConversa(id: string, usuarioId: string) {
    const c = await this.carregarConversa(id, usuarioId);
    const mensagens = c.mensagens
      .map((m) => ({
        papel: m.papel,
        texto: (m.conteudo as unknown as BlocoLlm[])
          .flatMap((b) => (b.tipo === 'texto' ? [b.texto] : []))
          .join('\n')
          .trim(),
        acoes: (m.acoes as unknown as AcaoSugerida[] | null) ?? [],
        criadoEm: m.criadoEm,
      }))
      .filter((m) => m.texto);
    const { mensagens: _, ...dados } = c;
    return { ...dados, mensagens };
  }

  // ---------------------------------------------------------------------------

  private provedorOuErro(): LlmProvider {
    if (!this.cfg.habilitado) {
      throw new ServiceUnavailableException('O assistente está desligado neste ambiente.');
    }
    if (!this.llm) {
      throw new ServiceUnavailableException(
        'O assistente não está configurado (falta a chave da API do provedor de IA). Avise o administrador do sistema.',
      );
    }
    return this.llm;
  }

  private async carregarConversa(id: string, usuarioId: string) {
    const c = await this.prisma.conversa.findFirst({
      where: { id, usuarioId },
      include: { mensagens: { orderBy: { ordem: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Conversa não encontrada');
    return c;
  }

  private async chamarModelo(llm: LlmProvider, mensagens: MensagemLlm[], permitirFerramentas: boolean) {
    try {
      return await llm.chat({
        sistema: PROMPT_SISTEMA,
        contexto: contextoDoDia(this.cfg.fuso),
        // Cópia: o loop continua acrescentando mensagens depois desta chamada
        mensagens: [...mensagens],
        ferramentas: DEFINICOES_FERRAMENTAS,
        permitirFerramentas,
      });
    } catch (e) {
      throw this.traduzirErro(e);
    }
  }

  /** Converte erros do provedor em mensagens amigáveis em português, sem detalhes internos. */
  traduzirErro(e: unknown): HttpException {
    if (e instanceof HttpException) return e;
    if (!(e instanceof LlmErro)) {
      this.logger.error(`Erro inesperado no assistente: ${e instanceof Error ? e.stack : String(e)}`);
      return new InternalServerErrorException('Erro inesperado no assistente.');
    }
    switch (e.tipo) {
      case 'limite_uso':
        this.logger.warn(`Limite de uso do provedor de IA atingido: ${e.message}`);
        return new HttpException(MENSAGEM_LIMITE_USO, HttpStatus.TOO_MANY_REQUESTS);
      case 'timeout':
        return new GatewayTimeoutException('O assistente demorou demais para responder. Tente de novo ou faça uma pergunta mais simples.');
      case 'conexao':
        return new ServiceUnavailableException('Não foi possível falar com o serviço de IA agora. Tente de novo em instantes.');
      case 'credencial':
        this.logger.error(`Credencial do provedor de IA rejeitada: ${e.message}`);
        return new ServiceUnavailableException('O assistente está indisponível por um problema de configuração. Avise o administrador do sistema.');
      case 'sem_creditos':
        this.logger.error(`Provedor de IA sem créditos: ${e.message}`);
        return new ServiceUnavailableException('O assistente está sem créditos de uso. Avise o administrador do sistema.');
      case 'indisponivel':
        return new ServiceUnavailableException('O serviço de IA está instável no momento. Tente de novo em instantes.');
      case 'requisicao_invalida':
        this.logger.error(`Requisição rejeitada pelo provedor de IA (${e.status}): ${e.message}`);
        return new BadGatewayException('O assistente não conseguiu responder agora. Tente de novo.');
      default:
        this.logger.error(`Erro do provedor de IA: ${e.message}`);
        return new BadGatewayException('O assistente não conseguiu responder agora. Tente de novo.');
    }
  }

  private somar(total: UsoTokens, u: UsoTokens) {
    total.entrada += u.entrada;
    total.saida += u.saida;
    total.cacheLeitura += u.cacheLeitura;
    total.cacheEscrita += u.cacheEscrita;
  }

  /** Log estruturado por chamada ao modelo (uma linha JSON, fácil de agregar). */
  private registrarUso(conversaId: string, usuarioId: string, iteracao: number, llm: LlmProvider, r: RespostaLlm) {
    this.logger.log(
      JSON.stringify({
        evento: 'assistente.uso_tokens',
        conversaId,
        usuarioId,
        iteracao,
        provedor: llm.nome,
        modelo: r.modelo,
        parada: r.parada,
        ...r.uso,
      }),
    );
  }

  private async gravarTurno(
    id: string,
    usuarioId: string,
    primeiraMensagem: string,
    ordemInicial: number | null,
    llm: LlmProvider,
    novas: MensagemNova[],
    total: UsoTokens,
    chamadas: number,
    tamanhoContexto: number,
  ) {
    const base = ordemInicial ?? 0;
    const json = (v: unknown) => v as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      if (ordemInicial === null) {
        await tx.conversa.create({
          data: { id, usuarioId, titulo: primeiraMensagem.slice(0, 80), provedor: llm.nome, modelo: llm.modelo },
        });
      }
      // @@unique([conversaId, ordem]) barra dois turnos simultâneos na mesma conversa
      await tx.mensagem.createMany({
        data: novas.map((m, i) => ({
          conversaId: id,
          ordem: base + i,
          papel: m.papel,
          conteudo: json(m.blocos),
          nativo: m.nativo === undefined ? undefined : json(m.nativo),
          acoes: m.acoes ? json(m.acoes) : undefined,
          uso: m.uso ? json(m.uso) : undefined,
        })),
      });
      await tx.conversa.update({
        where: { id },
        data: {
          modelo: llm.modelo,
          tokensEntrada: { increment: total.entrada },
          tokensSaida: { increment: total.saida },
          tokensCacheLeitura: { increment: total.cacheLeitura },
          tokensCacheEscrita: { increment: total.cacheEscrita },
          chamadasModelo: { increment: chamadas },
          tamanhoContexto,
        },
      });
    });
  }
}
