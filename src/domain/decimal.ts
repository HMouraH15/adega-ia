import { Prisma } from '@prisma/client';

/** Decimal de precisão arbitrária usado pelo Prisma (decimal.js). */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type ValorDecimal = Prisma.Decimal | number | string;
