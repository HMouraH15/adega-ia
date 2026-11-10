import { RegraNegocioError } from './errors';

export interface Periodo {
  inicio: Date;
  /** Exclusivo: primeiro instante do dia seguinte ao fim informado */
  fimExclusivo: Date;
  /** Datas como informadas (AAAA-MM-DD), para exibir */
  inicioTexto: string;
  fimTexto: string;
  dias: number;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

function paraData(texto: string, fuso: string): Date {
  if (!DATA.test(texto)) throw new RegraNegocioError(`Data inválida: "${texto}". Use AAAA-MM-DD`);
  const d = new Date(`${texto}T00:00:00${fuso}`);
  // Rejeita datas que o JS "corrige" (ex.: 2026-02-30)
  if (Number.isNaN(d.getTime()) || !mesmoDia(d, texto, fuso)) {
    throw new RegraNegocioError(`Data inválida: "${texto}"`);
  }
  return d;
}

function mesmoDia(d: Date, texto: string, fuso: string): boolean {
  return formatarData(d, fuso) === texto;
}

/** Formata uma data como AAAA-MM-DD no fuso informado (ex.: "-03:00"). */
export function formatarData(d: Date, fuso: string): string {
  const sinal = fuso.startsWith('-') ? -1 : 1;
  const [h, m] = fuso.replace(/^[+-]/, '').split(':').map(Number);
  const deslocado = new Date(d.getTime() + sinal * (h * 60 + (m || 0)) * 60_000);
  return deslocado.toISOString().slice(0, 10);
}

/** Período fechado [inicio, fim] em dias de calendário no fuso da loja. */
export function criarPeriodo(inicio: string, fim: string, fuso: string): Periodo {
  const i = paraData(inicio, fuso);
  const f = paraData(fim, fuso);
  if (f < i) throw new RegraNegocioError('A data final deve ser igual ou posterior à inicial');
  const fimExclusivo = new Date(f.getTime() + DIA_MS);
  return {
    inicio: i,
    fimExclusivo,
    inicioTexto: inicio,
    fimTexto: fim,
    dias: Math.round((fimExclusivo.getTime() - i.getTime()) / DIA_MS),
  };
}

/** Últimos N dias até hoje (inclusive), no fuso da loja. */
export function ultimosDias(dias: number, fuso: string, agora = new Date()): Periodo {
  const hoje = formatarData(agora, fuso);
  const inicio = formatarData(new Date(paraData(hoje, fuso).getTime() - (dias - 1) * DIA_MS), fuso);
  return criarPeriodo(inicio, hoje, fuso);
}
