import { IsOptional, IsString, Matches } from 'class-validator';

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Matches(GSTIN_PATTERN, { message: 'GSTIN format is invalid' })
  gstin?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  udyamNumber?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankIFSC?: string;

  @IsOptional()
  @IsString()
  bankBranch?: string;

  @IsOptional()
  @IsString()
  authorisedSignatory?: string;
}