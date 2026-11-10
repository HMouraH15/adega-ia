import { Perfil, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Cria o usuário ADMIN inicial e dados de exemplo.
 * E-mail e senha do ADMIN vêm SOMENTE de variáveis de ambiente — não há senha no código.
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_SENHA (mín. 8 caracteres)
 * Se o ADMIN já existir, a senha dele não é alterada.
 */
function exigirAmbiente(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) {
    throw new Error(`Defina a variável de ambiente ${nome} antes de rodar o seed.`);
  }
  return valor;
}

const prisma = new PrismaClient();

async function main() {
  const email = exigirAmbiente('SEED_ADMIN_EMAIL').toLowerCase();
  const senha = exigirAmbiente('SEED_ADMIN_SENHA');
  if (senha.length < 8) throw new Error('SEED_ADMIN_SENHA deve ter ao menos 8 caracteres.');

  await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nome: 'Administrador', email, senhaHash: await bcrypt.hash(senha, 10), perfil: Perfil.ADMIN },
  });

  const categorias: Record<string, string> = {};
  for (const nome of ['Vinhos', 'Cervejas', 'Destilados', 'Espumantes']) {
    const c = await prisma.categoria.upsert({ where: { nome }, update: {}, create: { nome } });
    categorias[nome] = c.id;
  }

  await prisma.fornecedor.upsert({
    where: { documento: '00.000.000/0001-00' },
    update: {},
    create: { nome: 'Distribuidora Exemplo', documento: '00.000.000/0001-00', contato: '(11) 4000-0000' },
  });

  if ((await prisma.produto.count()) === 0) {
    await prisma.produto.createMany({
      data: [
        { nome: 'Vinho Tinto Malbec 750ml', categoriaId: categorias.Vinhos, precoCusto: 42.5, precoVenda: 79.9, estoqueMinimo: 6 },
        { nome: 'Vinho Branco Sauvignon Blanc 750ml', categoriaId: categorias.Vinhos, precoCusto: 38, precoVenda: 69.9, estoqueMinimo: 6 },
        { nome: 'Cerveja IPA 500ml', categoriaId: categorias.Cervejas, precoCusto: 9.8, precoVenda: 18.9, estoqueMinimo: 24 },
        { nome: 'Gin London Dry 750ml', categoriaId: categorias.Destilados, precoCusto: 65, precoVenda: 119.9, estoqueMinimo: 3 },
        { nome: 'Espumante Brut 750ml', categoriaId: categorias.Espumantes, precoCusto: 35, precoVenda: 64.9, estoqueMinimo: 6 },
      ],
    });
  }

  console.log(`Seed concluído. ADMIN: ${email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
