import { IsOptional, IsString } from 'class-validator';

export class CreateTransportDto {
  @IsString()
  name: string;

  // v1.1: transporter's own GSTIN, shown on the invoice's Transporter ID section
  @IsOptional()
  @IsString()
  gstin?: string;
}
