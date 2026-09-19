import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateDisplayId } from '../src/common/utils/id-generator.util';
import { generateTemporaryPassword } from '../src/common/utils/password-generator.util';

const prisma = new PrismaClient();

// Never a fixed, published password: take SEED_PASSWORD from the environment, or generate a
// random one that is printed once below. Demo accounts only get it when first created.
const DEMO_PASSWORD = process.env.SEED_PASSWORD || generateTemporaryPassword(16);

async function upsertUser(params: {
  role: UserRole;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  const existing = await prisma.user.findUnique({ where: { employeeCode: params.employeeCode } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      role: params.role,
      employeeCode: params.employeeCode,
      generatedId: generateDisplayId(params.firstName, params.employeeCode),
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone,
      email: params.email,
      passwordHash,
    },
  });
  console.log(`✔ ${params.role} created — employeeCode: ${params.employeeCode}`);
  return user;
}

async function main() {
  // ── Singleton CompanySettings row ─────────────────────────────────
  const existingSettings = await prisma.companySettings.findFirst();
  if (!existingSettings) {
    await prisma.companySettings.create({
      data: {
        name: 'Rosal Safety Private Limited',
        gstin: '27AANCR7712A1ZF',
        address:
          'Godown 1876, Ram Avtar Compound, Shelar Road, Bhiwandi, Thane – 421302, Maharashtra',
        // Real letterhead details from the approved PI template; editable via
        // Admin > Company Settings.
        udyamNumber: 'UDYAM-MH-18-0365859',
        panNumber: 'AANCR7712A',
        bankName: 'State Bank of India CC A/C 1051',
        bankAccountNo: '45303521051',
        bankIFSC: 'SBIN0015781',
        bankBranch: 'SME BORIVALI',
        authorisedSignatory: 'Root Admin',
        officeAddress:
          '703 & 704, 7th Floor Kushal Point, Near Ghatkopar Metro Station – Ghatkopar West, Mumbai - 400086',
        declaration: [
          'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
          'Price is Ex-Factory, transport and other charges applicable.',
          "Transport damage is at customer's Risk.",
          'If payment is not made on due date Interest @ 2% p.m is applicable.',
          'Damage in product to be communicated in 2 days of receipt of material and the same to be returned to factory in 2 days of receipts.',
        ].join('\n'),
      },
    });
    console.log('✔ CompanySettings singleton created');
  }

  // ── One demo account per role ──────────────────────────────────────
  const admin = await upsertUser({
    role: UserRole.ADMIN,
    employeeCode: 'ADMIN-0001',
    firstName: 'Root',
    lastName: 'Admin',
    email: 'admin@rosalsafety.in',
    phone: '+910000000001',
  });

  const seller = await upsertUser({
    role: UserRole.SELLER,
    employeeCode: 'SELLER-0001',
    firstName: 'Aman',
    lastName: 'Kulkarni',
    email: 'aman.seller@rosalsafety.in',
    phone: '+910000000002',
  });

  const dispatcher = await upsertUser({
    role: UserRole.DISPATCHER,
    employeeCode: 'DISPATCH-0001',
    firstName: 'Rakesh',
    lastName: 'Pawar',
    email: 'rakesh.dispatcher@rosalsafety.in',
    phone: '+910000000003',
  });

  const accounts = await upsertUser({
    role: UserRole.ACCOUNTS,
    employeeCode: 'ACCOUNTS-0001',
    firstName: 'Priya',
    lastName: 'Shah',
    email: 'priya.accounts@rosalsafety.in',
    phone: '+910000000004',
  });

  // ── Supporting master data so the full PI -> Order -> Bill -> Invoice
  //    flow is actually testable end-to-end, not just logins ──────────

  let factoryUnit = await prisma.factoryUnit.findFirst({ where: { name: 'Bhiwandi Unit 1' } });
  if (!factoryUnit) {
    factoryUnit = await prisma.factoryUnit.create({
      data: {
        name: 'Bhiwandi Unit 1',
        assignedDispatcherId: dispatcher.id,
        // v1.1 — used as the Invoice's "Dispatch From" address
        address: 'Godown 1876, Ram Avtar Compound, Shelar Road, Bhiwandi, Thane – 421302, Maharashtra',
      },
    });
    console.log('✔ FactoryUnit "Bhiwandi Unit 1" created, assigned to DISPATCH-0001');
  }

  let client = await prisma.client.findFirst({ where: { gstin: '27ABCDE1234F1Z5' } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        firstName: 'Demo',
        lastName: 'Client',
        phone: '+919999999999',
        gstin: '27ABCDE1234F1Z5',
        address: 'Plot 12, MIDC Industrial Area, Thane, Maharashtra',
        assignedSellerId: seller.id,
      },
    });
    console.log('✔ Demo Client created, assigned to SELLER-0001');
  }

  let product = await prisma.product.findFirst({ where: { name: 'ABC Type Dry Powder Fire Extinguisher 6kg' } });
  if (!product) {
    product = await prisma.product.create({
      data: {
        name: 'ABC Type Dry Powder Fire Extinguisher 6kg',
        unit: 'PCS',
        taxPercent: 18,
        hsnCode: '842410000000',
      },
    });
    console.log('✔ Demo Product created');
  }

  let transport = await prisma.transport.findFirst({ where: { name: 'Standard Road Transport' } });
  if (!transport) {
    transport = await prisma.transport.create({
      data: { name: 'Standard Road Transport', gstin: '27AAACT1234F1Z8' },
    });
    console.log('✔ Demo Transport option created');
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('Demo accounts created in this run use password: ' + DEMO_PASSWORD);
  console.log('(Accounts that already existed keep their current password.)');
  console.log('  Admin:      ADMIN-0001');
  console.log('  Seller:     SELLER-0001');
  console.log('  Dispatcher: DISPATCH-0001');
  console.log('  Accounts:   ACCOUNTS-0001');
  console.log('⚠ These are dev-only credentials — never seed demo accounts in production.');
  console.log('──────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
