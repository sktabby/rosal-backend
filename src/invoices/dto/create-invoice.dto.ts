import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GstType } from '@prisma/client';

export class CreateInvoiceDto {
  @IsString()
  billId: string;

  @IsEnum(GstType)
  gstType: GstType;

  // v1.1: e-Way Bill / dispatch reference — manual entry, e-Way Bill
  // generation itself is out of scope.
  @IsOptional()
  @IsString()
  eWayBillNo?: string;

  @IsOptional()
  @IsString()
  dispatchDocNo?: string;

  // Defaults from the PI's transportType if omitted (see service).
  @IsOptional()
  @IsString()
  termsOfDelivery?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  // Buyer (Bill To) — defaults to the consignee (Ship To / Client) values if
  // omitted; only needed when the buyer genuinely differs from the consignee.
  @IsOptional()
  @IsString()
  buyerName?: string;

  @IsOptional()
  @IsString()
  buyerAddress?: string;

  @IsOptional()
  @IsString()
  buyerState?: string;

  @IsOptional()
  @IsString()
  buyerGstin?: string;

  @IsOptional()
  @IsString()
  buyerContact?: string;

  @IsOptional()
  @IsString()
  consigneeState?: string;

  @IsOptional()
  @IsString()
  externalFileUrl?: string;
}
