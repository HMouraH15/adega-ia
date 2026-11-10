import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ThrottlerModule } from '@nestjs/throttler';
import { Perfil } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Perfis, UsuarioAtual, UsuarioAutenticado } from '../../common/decorators/auth.decorators';
import { UsuarioThrottlerGuard } from '../../common/guards/usuario-throttler.guard';
import { FornecedoresModule } from '../fornecedores/fornecedores';
import { ProdutosModule } from '../produtos/produtos.module';
import { RelatoriosModule } from '../relatorios/relatorios.module';
import { CONFIG_ASSISTENTE, ConfigAssistente, criarProvedorLlm, lerConfigAssistente } from './assistente.config';
import { LLM_PROVIDER } from './llm/llm.types';
import { AssistenteService } from './assistente.service';
import { FerramentasAssistente } from './ferramentas';

export class ChatDto {
  @ApiProperty({ example: 'Quais produtos preciso repor esta semana?', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  mensagem: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Omita para iniciar uma nova conversa' })
  @IsOptional()
  @IsUUID()
  conversaId?: string;
}

@ApiTags('assistente')
@ApiBearerAuth()
@Perfis(Perfil.ADMIN)
@Controller('assistente')
export class AssistenteController {
  constructor(private readonly service: AssistenteService) {}

  @Post('chat')
  @HttpCode(200)
  @UseGuards(UsuarioThrottlerGuard)
  @ApiOperation({
    summary: 'Pergunta ao assistente de IA (somente ADMIN)',
    description:
      'A IA apenas consulta dados. Ações sugeridas vêm em `acoes`: o front-end mostra um botão e, se o usuário confirmar, envia `acoes[i].requisicao` para a API com o JWT do próprio usuário.',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit por usuário excedido' })
  chat(@Body() dto: ChatDto, @UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.chat(usuario.id, dto.mensagem.trim(), dto.conversaId);
  }

  @Get('conversas')
  @ApiOperation({ summary: 'Conversas do usuário, com uso de tokens acumulado' })
  conversas(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.listarConversas(usuario.id);
  }

  @Get('conversas/:id')
  @ApiOperation({ summary: 'Histórico legível de uma conversa' })
  conversa(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.obterConversa(id, usuario.id);
  }
}

@Module({
  imports: [
    ProdutosModule,
    RelatoriosModule,
    FornecedoresModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => [
        {
          ttl: Number(c.get('ASSISTENTE_RATE_TTL_MS', 60_000)),
          limit: Number(c.get('ASSISTENTE_RATE_LIMIT', 10)),
        },
      ],
    }),
  ],
  controllers: [AssistenteController],
  providers: [
    { provide: CONFIG_ASSISTENTE, inject: [ConfigService], useFactory: lerConfigAssistente },
    { provide: LLM_PROVIDER, inject: [CONFIG_ASSISTENTE], useFactory: (c: ConfigAssistente) => criarProvedorLlm(c) },
    FerramentasAssistente,
    AssistenteService,
  ],
})
export class AssistenteModule {}
