import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillStatus, GstType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { buildInvoiceNumber, currentFinancialYearLabel } from '../common/utils/id-generator.util';
import { amountToWords } from '../common/utils/number-to-words.util';
import { InvoicePdfLine, renderInvoicePdf } from './invoice-pdf';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  /**
   * gstType is a MANUAL Accounts choice (never auto-computed from state
   * comparison). Amounts are always recomputed server-side from the Bill's
   * line items + product tax rates — client-submitted totals are never
   * trusted.
   *
   * v1.1: generates the full real tax-invoice — Consignee/Buyer blocks,
   * Transporter snapshot, e-Way Bill/dispatch references, per-line discount,
   * round-off, amount-in-words, and a frozen CompanySettings snapshot (bank/
   * PAN/UDYAM/signatory as they existed AT GENERATION TIME — a legal
   * document must not silently change if company details are edited later,
   * same freeze principle as SalesOrder.lineItemsSnapshot).
   */
  async create(dto: CreateInvoiceDto, accountsUser: AuthenticatedUser) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: dto.billId },
      include: {
        lineItems: { include: { product: true } },
        invoice: true,
        client: true,
        order: {
          include: {
            proformaInvoice: { include: { transport: true } },
            factoryUnit: true,
          },
        },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.invoice) throw new BadRequestException('This bill already has an invoice');

    const companySettings = await this.prisma.companySettings.findFirst();
    if (!companySettings) {
      throw new BadRequestException('Company settings are not configured yet');
    }

    // ── Line items: discount applied before tax, per line ──────────────
    let taxableValue = 0;
    let taxTotal = 0;
    const invoiceLineItems = bill.lineItems.map((li) => {
      const discount = Number(li.discountPercent ?? 0);
      const lineGross = Number(li.qty) * Number(li.price);
      const lineNet = lineGross * (1 - discount / 100);
      const lineTax = lineNet * (Number(li.taxPercent) / 100);
      taxableValue += lineNet;
      taxTotal += lineTax;
      return {
        description: li.product.name,
        hsnCode: li.hsnCode,
        qty: li.qty,
        unit: li.product.unit,
        rate: li.price,
        discountPercent: li.discountPercent,
        amount: lineNet,
      };
    });

    const cgst = dto.gstType === GstType.CGST_SGST ? taxTotal / 2 : 0;
    const sgst = dto.gstType === GstType.CGST_SGST ? taxTotal / 2 : 0;
    const igst = dto.gstType === GstType.IGST ? taxTotal : 0;
    const taxRate = taxableValue > 0 ? (taxTotal / taxableValue) * 100 : 0;

    const preRound = taxableValue + taxTotal;
    const roundedGrandTotal = Math.round(preRound);
    const roundOff = roundedGrandTotal - preRound;

    // ── Invoice number (RSPL/<FY>/<series>) ─────────────────────────────
    const fy = currentFinancialYearLabel();
    const seriesCount = await this.prisma.invoice.count({
      where: { invoiceNumber: { startsWith: `RSPL/${fy}/` } },
    });
    const invoiceNumber = buildInvoiceNumber(seriesCount);

    // ── Consignee (Ship To) — from the Client + PI's shipToAddress ──────
    const consigneeName = `${bill.client.firstName} ${bill.client.lastName}`;
    const consigneeAddress = bill.order.proformaInvoice.shipToAddress || bill.client.address;
    const consigneeGstin = bill.client.gstin;
    const consigneeContact = bill.client.phone;

    // ── Buyer (Bill To) — defaults to consignee unless explicitly overridden ─
    const buyerName = dto.buyerName ?? consigneeName;
    const buyerAddress = dto.buyerAddress ?? bill.client.address;
    const buyerGstin = dto.buyerGstin ?? consigneeGstin;
    const buyerContact = dto.buyerContact ?? consigneeContact;

    // ── Transporter snapshot ────────────────────────────────────────────
    const transport = bill.order.proformaInvoice.transport;
    const termsOfDelivery =
      dto.termsOfDelivery ??
      (bill.order.proformaInvoice.transportType === 'DOOR_DELIVERY' ? 'Door Delivery' : 'Godown');

    // ── CompanySettings snapshot, frozen at generation time ─────────────
    const companySettingsSnapshot = {
      name: companySettings.name,
      gstin: companySettings.gstin,
      address: companySettings.address,
      udyamNumber: companySettings.udyamNumber,
      panNumber: companySettings.panNumber,
      bankName: companySettings.bankName,
      bankAccountNo: companySettings.bankAccountNo,
      bankIFSC: companySettings.bankIFSC,
      bankBranch: companySettings.bankBranch,
      authorisedSignatory: companySettings.authorisedSignatory,
      officeAddress: companySettings.officeAddress,
      declaration: companySettings.declaration,
      // "Dispatch From" — factory unit address if present, else default company address
      dispatchFromAddress: bill.order.factoryUnit.address || companySettings.address,
    };

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          billId: bill.id,
          invoiceNumber,
          gstType: dto.gstType,
          taxableValue,
          taxRate,
          cgst,
          sgst,
          igst,
          roundOff,
          grandTotal: roundedGrandTotal,
          amountInWords: amountToWords(roundedGrandTotal),
          eWayBillNo: dto.eWayBillNo,
          dispatchDocNo: dto.dispatchDocNo,
          termsOfDelivery,
          transportId: transport?.id,
          transporterName: transport?.name,
          transporterGstin: transport?.gstin,
          consigneeName,
          consigneeAddress,
          consigneeState: dto.consigneeState,
          consigneeGstin,
          consigneeContact,
          buyerName,
          buyerAddress,
          buyerState: dto.buyerState,
          buyerGstin,
          buyerContact,
          companySettingsSnapshot,
          remarks: dto.remarks,
          externalFileUrl: dto.externalFileUrl,
          createdByAccountsId: accountsUser.id,
          lineItems: { create: invoiceLineItems },
        },
        include: { lineItems: true },
      });

      await tx.bill.update({ where: { id: bill.id }, data: { status: BillStatus.INVOICED } });

      // BILLED is set on Invoice creation, NOT on Bill creation — per spec.
      await tx.salesOrder.update({
        where: { id: bill.orderId },
        data: { status: 'BILLED' },
      });

      return created;
    });

    await this.orderEvents.log({
      entityType: 'Invoice',
      entityId: invoice.id,
      action: 'created',
      actorId: accountsUser.id,
    });

    return invoice;
  }

  async findMany(params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;
    const where: any = {};
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { consigneeName: { contains: search, mode: 'insensitive' } },
        { buyerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { bill: { include: { client: true, order: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
        transport: true,
        bill: { include: { client: true, order: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /**
   * Renders the tax invoice PDF on demand from the frozen Invoice record (no
   * stored file, so a re-download always matches what was issued).
   */
  async renderPdf(id: string): Promise<{ fileName: string; pdf: Buffer }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
        bill: {
          include: {
            lineItems: { include: { product: true } },
            createdBySeller: { select: { firstName: true, lastName: true, phone: true, email: true } },
            order: { include: { proformaInvoice: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const snapshot = (invoice.companySettingsSnapshot ?? {}) as Record<string, string | null | undefined>;
    // Invoices issued before office address / declaration were snapshotted fall
    // back to the current settings for just those two letterhead fields.
    const needsCurrent = !('officeAddress' in snapshot) || !('declaration' in snapshot);
    const current = needsCurrent ? await this.prisma.companySettings.findFirst() : null;

    // Invoice lines don't store brand or tax rate; take them from the matching bill line.
    const billLines = [...invoice.bill.lineItems];
    const summaryRate = Number(invoice.taxRate);
    const lines: InvoicePdfLine[] = invoice.lineItems.map((li) => {
      const matchIdx = billLines.findIndex(
        (b) =>
          b.product.name === li.description &&
          b.hsnCode === li.hsnCode &&
          Number(b.qty) === Number(li.qty) &&
          Number(b.price) === Number(li.rate),
      );
      const match = matchIdx >= 0 ? billLines.splice(matchIdx, 1)[0] : undefined;
      return {
        description: li.description,
        hsnCode: li.hsnCode,
        brand: match?.brand,
        qty: Number(li.qty),
        unit: li.unit,
        rate: Number(li.rate),
        discountPercent: Number(li.discountPercent),
        taxPercent: match ? Number(match.taxPercent) : summaryRate,
        amount: Number(li.amount),
      };
    });

    const seller = invoice.bill.createdBySeller;
    const pi = invoice.bill.order.proformaInvoice;
    const pdf = await renderInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.createdAt,
      gstType: invoice.gstType,
      taxableValue: Number(invoice.taxableValue),
      grandTotal: Number(invoice.grandTotal),
      amountInWords: invoice.amountInWords,
      lines,
      company: {
        name: snapshot.name ?? 'Rosal Safety Private Limited',
        gstin: snapshot.gstin,
        factoryAddress: snapshot.address,
        officeAddress: 'officeAddress' in snapshot ? snapshot.officeAddress : current?.officeAddress,
        udyamNumber: snapshot.udyamNumber,
        panNumber: snapshot.panNumber,
        bankName: snapshot.bankName,
        bankAccountNo: snapshot.bankAccountNo,
        bankIFSC: snapshot.bankIFSC,
        bankBranch: snapshot.bankBranch,
        authorisedSignatory: snapshot.authorisedSignatory,
        declaration: 'declaration' in snapshot ? snapshot.declaration : current?.declaration,
      },
      buyer: {
        name: invoice.buyerName,
        address: invoice.buyerAddress,
        gstin: invoice.buyerGstin,
        state: invoice.buyerState,
        contact: invoice.buyerContact,
      },
      consignee: {
        name: invoice.consigneeName,
        address: invoice.consigneeAddress,
        gstin: invoice.consigneeGstin,
        state: invoice.consigneeState,
        contact: invoice.consigneeContact,
      },
      salesPerson: seller ? { name: `${seller.firstName} ${seller.lastName}`.trim(), phone: seller.phone, email: seller.email } : null,
      modeOfPayment: pi?.modeOfPayment,
      piNumber: pi?.piNumber,
      orderNumber: invoice.bill.order.orderNumber,
      dispatchDocNo: invoice.dispatchDocNo,
      eWayBillNo: invoice.eWayBillNo,
      transporterName: invoice.transporterName,
      termsOfDelivery: invoice.termsOfDelivery,
      remarks: invoice.remarks,
    });

    return { fileName: `${invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, pdf };
  }
}
