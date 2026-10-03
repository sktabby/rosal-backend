import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(2, { message: 'Contact name is required' })
  contactName: string;

  @IsString()
  @MinLength(2, { message: 'Company name is required' })
  company: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : value))
  @IsString()
  @MinLength(8, { message: 'Enter a valid phone number' })
  @MaxLength(20)
  phone: string;

  @IsString()
  @MinLength(2, { message: 'Product type is required' })
  productType: string;

  @IsString()
  @MinLength(2, { message: 'Select a category' })
  category: string;

  @IsString()
  @MinLength(3, { message: 'Subject is required' })
  subject: string;

  // Mirrors the frontend's z.union([z.literal(""), z.string().email()]) —
  // empty string is valid (field is optional in the UI), anything else must
  // be a real email.
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: 'Enter a valid email' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Honeypot — real users never fill this; bots do. */
  @IsOptional()
  @IsString()
  @MaxLength(0)
  botcheck?: string;
}
