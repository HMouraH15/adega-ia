import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Em produção a configuração vem só das variáveis de ambiente do servidor.
 * O Prisma Client carrega um arquivo .env automaticamente ao ser importado,
 * então um .env esquecido no servidor poderia preencher variáveis faltantes
 * sem ninguém perceber. Por isso a aplicação se recusa a iniciar nesse caso.
 * Esta checagem roda ANTES de importar o AppModule (que importa o Prisma).
 */
function garantirSemArquivoEnvEmProducao() {
  if (process.env.NODE_ENV !== 'production') return;
  const arquivo = resolve(__dirname, '..', '.env');
  if (existsSync(arquivo)) {
    throw new Error(
      `Arquivo ${arquivo} encontrado em produção. Remova-o e defina as variáveis de ambiente no servidor.`,
    );
  }
}

async function bootstrap() {
  garantirSemArquivoEnvEmProducao();
  const { AppModule } = await import('./app.module');
  const { configurarApp } = await import('./app.setup');

  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  app.enableShutdownHooks();

  const porta = Number(process.env.PORT ?? 3000);
  await app.listen(porta);
  Logger.log(`API em http://localhost:${porta}/api · Swagger em http://localhost:${porta}/docs`, 'Bootstrap');
}

bootstrap().catch((e) => {
  Logger.error(e instanceof Error ? e.message : String(e), 'Bootstrap');
  process.exit(1);
});
