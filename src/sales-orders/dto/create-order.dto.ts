import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  piId: string;

  @IsString()
  factoryUnitId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dispatchFrom?: string;
}
