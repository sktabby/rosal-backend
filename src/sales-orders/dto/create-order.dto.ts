import { IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  piId: string;

  @IsString()
  factoryUnitId: string;
}
