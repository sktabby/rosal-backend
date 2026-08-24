import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  employeeCode: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  /**
   * Single-use reCAPTCHA token from the admin UI widget. Checked against
   * Google's siteverify before the user is created, then discarded — it is
   * never persisted.
   */
  @IsString()
  @IsNotEmpty()
  captchaToken: string;
}
