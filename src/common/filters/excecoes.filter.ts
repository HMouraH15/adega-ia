import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { RegraNegocioError } from '../../domain/errors';

/**
 * Converte erros de domínio e do Prisma em respostas HTTP consistentes.
 * Erros não previstos viram 500 sem vazar detalhes internos.
 */
@Catch()
export class ExcecoesFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExcecoesFilter.name);

  catch(erro: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, corpo } = this.mapear(erro);
    res.status(status).json(corpo);
  }

  private mapear(erro: unknown): { status: number; corpo: object } {
    if (erro instanceof HttpException) {
      const r = erro.getResponse();
      return { status: erro.getStatus(), corpo: typeof r === 'string' ? { statusCode: erro.getStatus(), message: r } : r };
    }
    if (erro instanceof RegraNegocioError) {
      return this.resposta(HttpStatus.UNPROCESSABLE_ENTITY, erro.message);
    }
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      switch (erro.code) {
        case 'P2002':
          return this.resposta(HttpStatus.CONFLICT, 'Registro duplicado: já existe um item com esse valor único');
        case 'P2003':
          return this.resposta(HttpStatus.CONFLICT, 'Operação viola um vínculo com outro registro');
        case 'P2025':
          return this.resposta(HttpStatus.NOT_FOUND, 'Registro não encontrado');
      }
    }
    this.logger.error(erro instanceof Error ? erro.stack : String(erro));
    return this.resposta(HttpStatus.INTERNAL_SERVER_ERROR, 'Erro interno');
  }

  private resposta(status: number, message: string) {
    return { status, corpo: { statusCode: status, message } };
  }
}
