import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

/** Rate limit por usuário autenticado (cai para o IP se não houver usuário). */
@Injectable()
export class UsuarioThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Muitas perguntas em pouco tempo. Aguarde um pouco e tente de novo.');
  }
}
