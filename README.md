# Adega IA

API de gestão de adega em NestJS + Prisma + PostgreSQL, com um assistente de IA para o administrador (Google Gemini no plano gratuito, ou Anthropic Claude como opção).

## Como rodar (desenvolvimento)

```bash
docker compose up -d          # PostgreSQL 16
cp .env.example .env          # preencha JWT_SECRET, SEED_ADMIN_* e GEMINI_API_KEY
npm install
npx prisma migrate deploy     # cria as tabelas
npm run prisma:seed           # cria o ADMIN (SEED_ADMIN_EMAIL / SEED_ADMIN_SENHA) e dados de exemplo
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs` (clique em **Authorize** e cole o token de `POST /api/auth/login`)

## Testes

```bash
npm test          # unitários: sem banco e sem chamar nenhuma API de IA
npm run test:e2e  # e2e: PostgreSQL real (schema isolado "e2e"), provedor de IA falso
```

Os testes e2e usam o mesmo PostgreSQL do `DATABASE_URL`, mas sempre no schema `e2e`: os dados do schema `public` não são tocados. Use `E2E_DATABASE_URL` para apontar outro banco (ex.: no CI). Cobrem login → cadastros → compras → vendas → cancelamento → relatório de lucro, vendas simultâneas, e o assistente (ferramentas lendo o banco, histórico, 429, rate limit).

## Produção

- A configuração vem **somente das variáveis de ambiente do servidor**. Com `NODE_ENV=production`, a aplicação ignora o `.env` e **se recusa a iniciar se existir um arquivo `.env`**. O Prisma carregaria esse arquivo sozinho, preenchendo variáveis sem ninguém perceber.
- Variáveis obrigatórias: `DATABASE_URL`, `JWT_SECRET` (mín. 16 caracteres). As demais estão documentadas no `.env.example`.
- `npm run build && npx prisma migrate deploy && NODE_ENV=production npm run start:prod`

## Regras de negócio

| Regra | Onde |
|---|---|
| Compra soma ao estoque e recalcula o custo pela **média ponderada** | `src/domain/estoque.rules.ts`, `compras.service.ts` |
| Venda baixa o estoque e nunca o deixa negativo (bloqueio `FOR UPDATE` + decremento condicional) | `vendas.service.ts` |
| Cada item de venda grava o **custo do momento**, então o lucro histórico não muda quando o custo muda | `vendas.service.ts`, `lucro.rules.ts` |
| **Cancelamento** (`POST /api/vendas/:id/cancelar`, só ADMIN): devolve o estoque, só pode ser feito uma vez, e a venda sai de todos os relatórios | `vendas.service.ts`, `relatorios.service.ts` |
| Valores em `Decimal` (sem erro de ponto flutuante), arredondados em centavos só no total | `src/domain/lucro.rules.ts` |
| Produto é desativado, nunca apagado (preserva o histórico) | `produtos.service.ts` |

Perfis: **ADMIN** (tudo) e **VENDEDOR** (consulta produtos e registra vendas). Usuários novos são criados por um ADMIN em `POST /api/auth/registrar`.

## Assistente de IA (`POST /api/assistente/chat`, somente ADMIN)

```json
{ "mensagem": "O que preciso repor para as próximas 2 semanas?", "conversaId": "opcional" }
```

Resposta: `{ conversaId, resposta, acoes, ferramentasUsadas, truncada, provedor, uso }`.

### Provedores

`LLM_PROVIDER=gemini|anthropic` escolhe a implementação de `LlmProvider` (`src/modules/assistente/llm/`):

| Provedor | Variáveis | Observação |
|---|---|---|
| **Gemini** (padrão) | `GEMINI_API_KEY`, `GEMINI_MODEL` (padrão `gemini-3.8-flash`), `GEMINI_THINKING_LEVEL` | SDK oficial `@google/genai`. Tem plano gratuito |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | Pago por uso |

Cada conversa continua sempre no provedor em que começou. O conteúdo original de cada resposta (as *thought signatures* do Gemini e os blocos de raciocínio do Claude) é gravado e reenviado sem alteração, como os dois provedores exigem.

### Regras

- **Ferramentas somente leitura**: `buscar_produtos`, `estoque_baixo`, `relatorio_lucro`, `vendas_por_periodo`, `produtos_mais_vendidos`, `sugerir_reposicao`, `sugerir_preco`. Todas usam os services existentes.
- **A IA nunca grava nada.** `propor_compra` e `propor_ajuste_preco` só devolvem um item em `acoes`, com a `requisicao` pronta (`metodo`, `caminho`, `corpo`) e os `camposPendentes`. O front-end mostra um botão. Se o usuário confirmar, envia a requisição com o **JWT do próprio usuário**, e ela passa pela validação normal da API.
- **Sem dados pessoais para o modelo** (`privacidade.ts`): tudo que as ferramentas devolvem passa por uma **lista de campos permitidos** (produtos, estoque, vendas e valores agregados). Qualquer outro campo é descartado. E-mails, telefones, CPF/CNPJ e CEPs digitados em textos livres são mascarados. Nomes de fornecedores e usuários não são enviados.
- **Prompt de sistema** (`assistente.prompt.ts`) em português: só responde sobre o negócio, usa apenas números das ferramentas, informa o período e avisa quando não há dados.
- **Erros amigáveis** (nenhum detalhe interno vaza, e o turno com erro não é gravado):

  | Situação | HTTP | Mensagem |
  |---|---|---|
  | Cota do provedor esgotada | 429 | "Limite de uso do assistente atingido. Tente novamente em alguns minutos." |
  | Timeout | 504 | — |
  | Chave inválida ou instabilidade | 503 | — |
- **Rate limit interno** por usuário (`ASSISTENTE_RATE_LIMIT` a cada `ASSISTENTE_RATE_TTL_MS`). Ele barra o excesso antes de gastar a cota do provedor.
- **Log de tokens**: uma linha JSON por chamada ao modelo (`evento: "assistente.uso_tokens"`, com provedor e modelo) e totais acumulados em `Conversa`.

### Plano gratuito do Gemini: o que saber

- **Privacidade:** no plano gratuito, o Google informa que o conteúdo enviado pode ser usado para melhorar os produtos dele. Por isso existe o filtro de dados pessoais acima. Mesmo assim, **não digite dados pessoais de clientes nas perguntas**: o texto da pergunta vai para o modelo como você escreveu.
- **Cotas:** são por minuto e por dia, por projeto, e o Google pode mudá-las. Veja as suas em <https://aistudio.google.com/rate-limit>. Cada pergunta pode usar de 1 a `ASSISTENTE_MAX_ITERACOES` (padrão 4) chamadas ao modelo. Se a cota diária do Flash ficar curta, o Flash-Lite costuma ter cota maior: `GEMINI_MODEL=gemini-3.5-flash-lite`.
- **Para gastar menos cota:** `GEMINI_THINKING_LEVEL=LOW`, `LLM_MAX_RETRIES=0` (não repete após 429) e respostas curtas (`LLM_MAX_TOKENS`).
- Para desligar o assistente: `ASSISTENTE_HABILITADO=false`.

## Estrutura

```
prisma/                    schema, migrations, seed
src/domain/                regras puras (estoque, lucro, reposição, preço, período) + testes
src/common/                decorators, guards (perfil, rate limit), filtro de exceções, DTOs
src/modules/               auth, categorias, produtos, fornecedores, compras, vendas, relatorios
src/modules/assistente/    chat, ferramentas, privacidade, llm/ (LlmProvider, Gemini, Anthropic)
test/                      testes e2e (banco real)
```
