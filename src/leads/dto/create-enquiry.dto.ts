import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEnquiryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCategory?: string;

  /** Honeypot — real users never fill this; bots do. */
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}
