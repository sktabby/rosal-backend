import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuoteApplicationType } from '@prisma/client';
import { QuoteProductDto } from './quote-product.dto';

export class CreateQuoteRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteProductDto)
  products: QuoteProductDto[];

  @IsEnum(QuoteApplicationType)
  applicationType: QuoteApplicationType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  budgetRange?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;
}
