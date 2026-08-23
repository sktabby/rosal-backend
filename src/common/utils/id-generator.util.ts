/**
 * Generated display ID = firstName + last 5 digits of employeeCode.
 * e.g. firstName "Aman", employeeCode "SELLER-27891" -> "AMAN-27891"
 */
export function generateDisplayId(firstName: string, employeeCode: string): string {
  const digitsOnly = employeeCode.replace(/\D/g, '');
  const last5 = digitsOnly.slice(-5).padStart(5, '0');
  return `${firstName.toUpperCase().replace(/\s+/g, '')}-${last5}`;
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
