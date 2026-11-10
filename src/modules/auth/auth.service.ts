import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Perfil } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegistrarUsuarioDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

const usuarioPublico = { id: true, nome: true, email: true, perfil: true, criadoEm: true } as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const usuario = await this.prisma.usuario.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Mesma mensagem para e-mail inexistente e senha errada (não revela quais e-mails existem)
    if (!usuario || !(await bcrypt.compare(dto.senha, usuario.senhaHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const payload: JwtPayload = { sub: usuario.id, email: usuario.email, perfil: usuario.perfil };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  async registrar(dto: RegistrarUsuarioDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { email } })) {
      throw new ConflictException('E-mail já cadastrado');
    }
    return this.prisma.usuario.create({
      data: {
        nome: dto.nome,
        email,
        senhaHash: await bcrypt.hash(dto.senha, 10),
        perfil: dto.perfil ?? Perfil.VENDEDOR,
      },
      select: usuarioPublico,
    });
  }

  async perfil(id: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id }, select: usuarioPublico });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
    return usuario;
  }
}
