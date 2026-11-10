import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { Perfis, Publico, UsuarioAtual, UsuarioAutenticado } from '../../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto, RegistrarUsuarioDto, TokenDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Autentica e devolve um JWT' })
  @ApiOkResponse({ type: TokenDto })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Perfis(Perfil.ADMIN)
  @Post('registrar')
  @ApiOperation({ summary: 'Cadastra um usuário (somente ADMIN)' })
  registrar(@Body() dto: RegistrarUsuarioDto) {
    return this.auth.registrar(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Dados do usuário autenticado' })
  me(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.auth.perfil(usuario.id);
  }
}
