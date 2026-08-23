import { IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  unit: string;

  @IsNumber()
  @Min(0)
  @Max(28)
  taxPercent: number;

  // Hard-validated server-side: exactly 12 digits, never trust client-side validation alone
  @Matches(/^\d{12}$/, { message: 'HSN code must be exactly 12 digits' })
  hsnCode: string;
}
