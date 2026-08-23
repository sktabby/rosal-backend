import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  employeeCode: string;

  @IsString()
  @MinLength(1)
  password: string;
}
