/** Erro de regra de negócio. Convertido em HTTP 422 pelo filtro global. */
export class RegraNegocioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegraNegocioError';
  }
}

export class EstoqueInsuficienteError extends RegraNegocioError {
  constructor(
    public readonly produtoId: string,
    public readonly disponivel: number,
    public readonly solicitado: number,
  ) {
    super(
      `Estoque insuficiente para o produto ${produtoId}: disponível ${disponivel}, solicitado ${solicitado}`,
    );
    this.name = 'EstoqueInsuficienteError';
  }
}
