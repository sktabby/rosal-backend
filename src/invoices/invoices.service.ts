import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillStatus, GstType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { buildInvoiceNumber, currentFinancialYearLabel } from '../common/utils/id-generator.util';
import { amountToWords } from '../common/utils/number-to-words.util';

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
   * PDF generation is a stub here — wire in a headless render/template engine
   * (e.g. Puppeteer + an HTML invoice template, or a PDF-generation library)
   * once the final layout pass against the handwritten reference is done.
   * All the fields needed for that template now exist on the Invoice record
   * itself (see schema v1.1) — this just needs the actual rendering step.
   */
  async getPdfUrl(id: string) {
    const invoice = await this.findOne(id);
    if (invoice.pdfUrl) return { pdfUrl: invoice.pdfUrl };
    throw new BadRequestException('Invoice PDF generation not yet configured');
  }
}
