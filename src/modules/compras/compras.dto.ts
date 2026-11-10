import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsNumber, IsUUID, Min, ValidateNested } from 'class-validator';

export class ItemCompraDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  produtoId: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  quantidade: number;

  @ApiProperty({ example: 38.9 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  custoUnitario: number;
}

export class CriarCompraDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fornecedorId: string;

  @ApiProperty({ type: [ItemCompraDto] })
  @ValidateNested({ each: true })
  @Type(() => ItemCompraDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  itens: ItemCompraDto[];
}
