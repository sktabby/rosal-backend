import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class TcItemDto {
  @IsString()
  lineItemId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;
}

export class SaveTcDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TcItemDto)
  items: TcItemDto[];
}
