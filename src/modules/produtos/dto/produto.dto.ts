import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

export class CriarProdutoDto {
  @ApiProperty({ example: 'Vinho Tinto Malbec 750ml' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nome: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoriaId: string;

  @ApiProperty({ example: 42.5, description: 'Custo inicial; depois é recalculado pela média ponderada das compras' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  precoCusto: number;

  @ApiProperty({ example: 79.9 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precoVenda: number;

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(0)
  estoqueMinimo: number;
}

/** Estoque e custo não são editáveis aqui: mudam só por compras e vendas. */
export class AtualizarProdutoDto extends PartialType(OmitType(CriarProdutoDto, ['precoCusto'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class FiltroProdutosDto extends PaginacaoDto {
  @ApiPropertyOptional({ description: 'Parte do nome' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  termo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => (value === 'false' ? false : value === 'true' ? true : value))
  @IsBoolean()
  ativo?: boolean = true;
}
