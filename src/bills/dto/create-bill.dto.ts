import { IsString } from 'class-validator';

export class CreateBillDto {
  @IsString()
  orderId: string;
}
