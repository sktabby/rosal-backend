import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Generated display ID = firstName + last 5 digits of employeeCode.
 * e.g. firstName "Aman", employeeCode "RS0001S" -> "AMAN-00001"
 */
export function generateDisplayId(firstName: string, employeeCode: string): string {
  const digitsOnly = employeeCode.replace(/\D/g, '');
  const last5 = digitsOnly.slice(-5).padStart(5, '0');
  return `${firstName.toUpperCase().replace(/\s+/g, '')}-${last5}`;
}

/**
 * Employee Code format: RS + 4-digit number + one role letter, e.g. "RS0001S".
 * The admin only ever types the number; the RS prefix and role letter are
 * always applied automatically (by the website form, and re-checked here).
 * ADMIN accounts are seeded directly and never created through this format.
 */
export const EMPLOYEE_CODE_ROLE_SUFFIX: Partial<Record<UserRole, string>> = {
  [UserRole.SELLER]: 'S',
  [UserRole.DISPATCHER]: 'D',
  [UserRole.ACCOUNTS]: 'A',
};

/** Throws if `code` isn't RS + 4 digits + the letter for `role` (skipped for ADMIN). */
export function assertValidEmployeeCode(code: string, role: UserRole): void {
  const suffix = EMPLOYEE_CODE_ROLE_SUFFIX[role];
  if (!suffix) return; // ADMIN — not created via this format
  const pattern = new RegExp(`^RS\\d{4}${suffix}$`);
  if (!pattern.test(code)) {
    throw new BadRequestException(`Employee Code must be in the format RS0000${suffix} for this role`);
  }
}

/** Current Indian financial year label, e.g. "26-27" for FY 2026-27 (Apr–Mar). */
export function currentFinancialYearLabel(date: Date = new Date()): string {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

/** Builds the next PI number given the count of PIs already created this FY. */
export function buildPiNumber(seriesCount: number, date: Date = new Date()): string {
  const fy = currentFinancialYearLabel(date);
  const series = String(seriesCount + 1).padStart(3, '0');
  return `RSPL/${fy}/${series}`;
}

/** Builds the next Order number given the running total order count. */
export function buildOrderNumber(seriesCount: number): string {
  return `ORD-${String(seriesCount + 1).padStart(4, '0')}`;
}

/** Builds the next Invoice number given the count of invoices already issued this FY. */
export function buildInvoiceNumber(seriesCount: number, date: Date = new Date()): string {
  const fy = currentFinancialYearLabel(date);
  const series = String(seriesCount + 1).padStart(3, '0');
  return `RSPL/${fy}/${series}`;
}
