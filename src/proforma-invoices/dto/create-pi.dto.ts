import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsString, ValidateNested } from 'class-validator';
import { TransportType } from '@prisma/client';
import { PiLineItemDto } from './pi-line-item.dto';

export class CreatePiDto {
  @IsString()
  clientId: string;

  @IsString()
  shipToAddress: string;

  @IsString()
  modeOfPayment: string;

  @IsString()
  transportId: string;

  @IsEnum(TransportType)
  transportType: TransportType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PiLineItemDto)
  lineItems: PiLineItemDto[];
}
