import { IsOptional, IsString } from 'class-validator';

export class CreateFactoryUnitDto {
  @IsString()
  name: string;

  @IsString()
  assignedDispatcherId: string;

  // v1.1: used as the Invoice's "Dispatch From" address
  @IsOptional()
  @IsString()
  address?: string;
}
