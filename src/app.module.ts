import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ExcecoesFilter } from './common/filters/excecoes.filter';
import { PerfisGuard } from './common/guards/perfis.guard';
import { validarAmbiente } from './config/env.validation';
import { AssistenteModule } from './modules/assistente/assistente.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CategoriasModule } from './modules/categorias/categorias';
import { ComprasModule } from './modules/compras/compras.module';
import { FornecedoresModule } from './modules/fornecedores/fornecedores';
import { ProdutosModule } from './modules/produtos/produtos.module';
import { RelatoriosModule } from './modules/relatorios/relatorios.module';
import { VendasModule } from './modules/vendas/vendas.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validarAmbiente,
      // Em produção usa só as variáveis de ambiente do servidor; o .env é para desenvolvimento local.
      // (Fora de produção, variáveis do sistema também têm prioridade sobre o .env.)
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    PrismaModule,
    AuthModule,
    CategoriasModule,
    ProdutosModule,
    FornecedoresModule,
    ComprasModule,
    VendasModule,
    RelatoriosModule,
    AssistenteModule,
  ],
  providers: [
    // Ordem importa: primeiro autentica (JWT), depois checa o perfil
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PerfisGuard },
    { provide: APP_FILTER, useClass: ExcecoesFilter },
  ],
})
export class AppModule {}
