import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PiLineItemDto {
  @IsString()
  productId: string;

  @IsString()
  brand: string;

  @IsNumber()
  @Min(0.01)
  qty: number;

  @IsNumber()
  @Min(0)
  price: number;

  // v1.1: optional per-line discount, defaults to 0
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;
}
