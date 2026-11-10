import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ItemVendaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  produtoId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantidade: number;

  @ApiPropertyOptional({ example: 75, description: 'Padrão: preço de venda atual do produto (informe para dar desconto)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precoUnitario?: number;
}

export class CriarVendaDto {
  @ApiProperty({ type: [ItemVendaDto] })
  @ValidateNested({ each: true })
  @Type(() => ItemVendaDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  itens: ItemVendaDto[];
}

export class CancelarVendaDto {
  @ApiProperty({ example: 'Cliente desistiu da compra', minLength: 3, maxLength: 300 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  motivo: string;
}
