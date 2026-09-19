-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN "officeAddress" TEXT,
ADD COLUMN "declaration" TEXT;

-- Fill the PI letterhead with the company's real details (from the approved PI
-- template), but only where a field is still empty or holds the seed script's
-- placeholder — anything an admin already entered is left untouched.
UPDATE "CompanySettings" SET
  "officeAddress" = COALESCE("officeAddress", '703 & 704, 7th Floor Kushal Point, Near Ghatkopar Metro Station – Ghatkopar West, Mumbai - 400086'),
  "declaration" = COALESCE("declaration", E'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.\nPrice is Ex-Factory, transport and other charges applicable.\nTransport damage is at customer''s Risk.\nIf payment is not made on due date Interest @ 2% p.m is applicable.\nDamage in product to be communicated in 2 days of receipt of material and the same to be returned to factory in 2 days of receipts.'),
  "udyamNumber" = COALESCE(NULLIF("udyamNumber", ''), 'UDYAM-MH-18-0365859'),
  "panNumber" = COALESCE(NULLIF("panNumber", ''), 'AANCR7712A'),
  "bankName" = CASE WHEN "bankName" IS NULL OR "bankName" = '' OR "bankAccountNo" = '00000000000000'
                    THEN 'State Bank of India CC A/C 1051' ELSE "bankName" END,
  "bankBranch" = CASE WHEN "bankBranch" IS NULL OR "bankBranch" = '' OR "bankAccountNo" = '00000000000000'
                      THEN 'SME BORIVALI' ELSE "bankBranch" END,
  "bankIFSC" = CASE WHEN "bankIFSC" IS NULL OR "bankIFSC" = '' OR "bankIFSC" = 'SBIN0000000'
                    THEN 'SBIN0015781' ELSE "bankIFSC" END,
  "bankAccountNo" = CASE WHEN "bankAccountNo" IS NULL OR "bankAccountNo" = '' OR "bankAccountNo" = '00000000000000'
                         THEN '45303521051' ELSE "bankAccountNo" END;
