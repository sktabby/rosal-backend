import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDistributorApplicationDto {
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

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  country: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  zipcode: string;

  @IsString()
  @MinLength(10)
  @MaxLength(25)
  gstin: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  experience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  /** Honeypot — real users never fill this; bots do. */
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}
