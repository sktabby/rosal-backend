import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ContactSubject } from '@prisma/client';

export class CreateContactLeadDto {
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

  @IsEnum(ContactSubject)
  subject: ContactSubject;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  /** Honeypot — real users never fill this; bots do. */
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}
