import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Configuração HTTP compartilhada entre main.ts e os testes e2e. */
export function configurarApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const doc = new DocumentBuilder()
    .setTitle('Adega IA')
    .setDescription('API de gestão de adega: produtos, compras, vendas, relatórios e assistente de IA')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
}
