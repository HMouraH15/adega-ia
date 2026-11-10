import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Perfil } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@adega.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'sua-senha' })
  @IsString()
  @IsNotEmpty()
  senha: string;
}

export class RegistrarUsuarioDto {
  @ApiProperty({ example: 'Maria Vendedora' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nome: string;

  @ApiProperty({ example: 'maria@adega.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  senha: string;

  @ApiPropertyOptional({ enum: Perfil, default: Perfil.VENDEDOR })
  @IsOptional()
  @IsEnum(Perfil)
  perfil?: Perfil;
}

export class TokenDto {
  @ApiProperty()
  accessToken: string;
}
