import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Perfil } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsuarioAutenticado } from '../../common/decorators/auth.decorators';

export interface JwtPayload {
  sub: string;
  email: string;
  perfil: Perfil;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): UsuarioAutenticado {
    return { id: payload.sub, email: payload.email, perfil: payload.perfil };
  }
}
