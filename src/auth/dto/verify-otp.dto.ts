import { IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  employeeCode: string;

  @IsString()
  @Length(4, 8)
  otp: string;
}
