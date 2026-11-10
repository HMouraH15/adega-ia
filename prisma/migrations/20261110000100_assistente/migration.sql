-- CreateTable
CREATE TABLE "Conversa" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheLeitura" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheEscrita" INTEGER NOT NULL DEFAULT 0,
    "chamadasModelo" INTEGER NOT NULL DEFAULT 0,
    "tamanhoContexto" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensagem" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "papel" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "nativo" JSONB,
    "acoes" JSONB,
    "uso" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversa_usuarioId_atualizadoEm_idx" ON "Conversa"("usuarioId", "atualizadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Mensagem_conversaId_ordem_key" ON "Mensagem"("conversaId", "ordem");

-- AddForeignKey
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

