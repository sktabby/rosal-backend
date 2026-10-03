import { IsNumber, IsString, Min } from 'class-validator';

export class QuoteProductDto {
  @IsString()
  id: string;

  @IsNumber()
  @Min(1)
  qty: number;
}
