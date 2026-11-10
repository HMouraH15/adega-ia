/**
 * Prepara o banco dos testes e2e:
 *  1. usa o mesmo PostgreSQL do DATABASE_URL, mas sempre no schema isolado "e2e"
 *     (os dados de desenvolvimento no schema "public" não são tocados);
 *  2. aplica as migrations (prisma migrate deploy);
 *  3. limpa as tabelas do schema e2e e roda o seed real com um ADMIN de teste.
 *
 * Use E2E_DATABASE_URL para apontar para outro banco (ex.: no CI).
 */
const { execSync } = require('child_process');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const TABELAS = ['VendaItem', 'Venda', 'CompraItem', 'Compra', 'Produto', 'Fornecedor', 'Categoria', 'Usuario'];

module.exports = async () => {
  const raiz = path.resolve(__dirname, '..');
  const arquivoEnv = path.join(raiz, '.env');
  const local = fs.existsSync(arquivoEnv) ? dotenv.parse(fs.readFileSync(arquivoEnv)) : {};

  const base = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || local.DATABASE_URL;
  if (!base) throw new Error('Defina DATABASE_URL (ou E2E_DATABASE_URL) para rodar os testes e2e.');
  const url = new URL(base);
  url.searchParams.set('schema', 'e2e');

  // Variáveis herdadas pelos workers do Jest (e lidas pelo ConfigModule antes do .env)
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
  process.env.ASSISTENTE_HABILITADO = 'false';
  process.env.SEED_ADMIN_EMAIL = 'admin.e2e@adega.local';
  process.env.SEED_ADMIN_SENHA = randomBytes(12).toString('base64url');
  process.env.E2E_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
  process.env.E2E_ADMIN_SENHA = process.env.SEED_ADMIN_SENHA;

  const exec = (cmd) => execSync(cmd, { cwd: raiz, env: process.env, stdio: ['ignore', 'ignore', 'inherit'] });
  exec('npx prisma migrate deploy');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const [{ schema }] = await prisma.$queryRawUnsafe('SELECT current_schema() AS schema');
    if (schema !== 'e2e') throw new Error(`Recusando limpar o schema "${schema}" (esperado "e2e")`);
    await prisma.$executeRawUnsafe(`TRUNCATE ${TABELAS.map((t) => `"${t}"`).join(', ')} CASCADE`);
  } finally {
    await prisma.$disconnect();
  }

  exec('npx ts-node prisma/seed.ts');
};
