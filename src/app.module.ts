import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExcecoesFilter } from './common/filters/excecoes.filter';
import { validarAmbiente } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { APP_FILTER } from '@nestjs/core';

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
  ],
  providers: [
    { provide: APP_FILTER, useClass: ExcecoesFilter },
  ],
})
export class AppModule {}
