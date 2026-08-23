import { IsString, Matches } from 'class-validator';

// Standard Indian GSTIN pattern: 2-digit state code, 10-char PAN, entity code,
// 'Z' literal, checksum digit — e.g. 27AANCR7712A1ZF
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

export class CreateClientDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone: string;

  @Matches(GSTIN_PATTERN, { message: 'GSTIN format is invalid' })
  gstin: string;

  @IsString()
  address: string;

  @IsString()
  assignedSellerId: string;
}
