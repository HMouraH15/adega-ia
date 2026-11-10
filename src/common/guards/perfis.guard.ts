import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Perfil } from '@prisma/client';
import { PERFIS, PUBLICO, UsuarioAutenticado } from '../decorators/auth.decorators';

@Injectable()
export class PerfisGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const alvos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, alvos)) return true;
    const perfis = this.reflector.getAllAndOverride<Perfil[]>(PERFIS, alvos);
    if (!perfis?.length) return true;
    const usuario: UsuarioAutenticado | undefined = ctx.switchToHttp().getRequest().user;
    if (!usuario || !perfis.includes(usuario.perfil)) {
      throw new ForbiddenException('Seu perfil não tem acesso a este recurso');
    }
    return true;
  }
}
