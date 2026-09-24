import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitLrDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lrNumber: string;
}
