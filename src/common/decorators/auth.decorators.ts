import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Perfil } from '@prisma/client';

export interface UsuarioAutenticado {
  id: string;
  email: string;
  perfil: Perfil;
}

export const PUBLICO = 'publico';
/** Libera a rota do guard JWT global. */
export const Publico = () => SetMetadata(PUBLICO, true);

export const PERFIS = 'perfis';
/** Restringe a rota aos perfis informados. */
export const Perfis = (...perfis: Perfil[]) => SetMetadata(PERFIS, perfis);

/** Injeta o usuário autenticado (payload do JWT validado). */
export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioAutenticado => ctx.switchToHttp().getRequest().user,
);
