import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarAmbiente } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validarAmbiente,
      // Em produção usa só as variáveis de ambiente do servidor; o .env é para desenvolvimento local.
      // (Fora de produção, variáveis do sistema também têm prioridade sobre o .env.)
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),

  ],
  providers: [],
})
export class AppModule {}
