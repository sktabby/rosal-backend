import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { CreateContactLeadDto } from './dto/create-contact-lead.dto';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { CreateDistributorApplicationDto } from './dto/create-distributor-application.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br/>');
}

export const LEAD_TYPES = ['contact', 'quote', 'enquiry', 'distributor', 'support', 'subscriber'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);
  /** Where admin-facing notification emails (contact, quote) are sent. */
  private readonly notifyEmail: string;

  constructor(private prisma: PrismaService, private mail: MailService, private config: ConfigService) {
    this.notifyEmail = this.config.get<string>('LEADS_NOTIFY_EMAIL') ?? 'info@rosalsafety.com';
  }

  async createContactLead(dto: CreateContactLeadDto) {
    // Honeypot tripped — accept silently, don't persist, don't email.
    if (dto.website) return { ok: true };

    await this.prisma.contactLead.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
      },
    });

    const safeName = escapeHtml(dto.name);
    const safeEmail = escapeHtml(dto.email);
    const safePhone = escapeHtml(dto.phone);
    const safeSubject = escapeHtml(dto.subject);
    const safeMessage = escapeHtmlMultiline(dto.message);

    await this.sendBestEffort(this.notifyEmail, `[Website] ${dto.subject} — ${dto.name}`, {
      html: `<p><strong>${safeName}</strong> (${safeEmail}) ${safePhone}</p><p><strong>Subject:</strong> ${safeSubject}</p><p>${safeMessage}</p>`,
    });
    await this.sendBestEffort(dto.email, 'We received your message — Rosal Safety', {
      html: `<p>Hi ${safeName},</p><p>Thanks for contacting Rosal Safety. A coordinator will reply shortly.</p><p>Your message:<br/>${safeMessage}</p>`,
    });

    return { ok: true };
  }

  async createQuoteRequest(dto: CreateQuoteRequestDto) {
    await this.prisma.quoteRequest.create({
      data: {
        companyName: dto.companyName,
        contactName: dto.contactName,
        email: dto.email,
        phone: dto.phone,
        city: dto.city,
        state: dto.state,
        applicationType: dto.applicationType,
        budgetRange: dto.budgetRange ?? null,
        message: dto.message ?? null,
        products: dto.products as unknown as object,
      },
    });

    const lines = dto.products.map((p) => `<li>${escapeHtml(String(p.id))} × ${escapeHtml(String(p.qty))}</li>`).join('');
    const msg = dto.message ? `<p>${escapeHtmlMultiline(dto.message)}</p>` : '';

    await this.sendBestEffort(this.notifyEmail, `Quote request — ${dto.companyName}`, {
      html: `<p><strong>${escapeHtml(dto.contactName)}</strong> (${escapeHtml(dto.email)}) ${escapeHtml(dto.phone)}</p>
      <p>${escapeHtml(dto.city)}, ${escapeHtml(dto.state)}</p>
      <p>Application: ${escapeHtml(dto.applicationType)}</p>
      <ul>${lines}</ul>
      ${dto.budgetRange ? `<p>Budget: ${escapeHtml(dto.budgetRange)}</p>` : ''}
      ${msg}`,
    });

    return { ok: true };
  }

  async createEnquiry(dto: CreateEnquiryDto) {
    if (dto.website) return { ok: true };

    await this.prisma.enquiry.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company ?? null,
        city: dto.city ?? null,
        message: dto.message,
        productName: dto.productName ?? null,
        productSlug: dto.productSlug ?? null,
        productLine: dto.productLine ?? null,
        productCategory: dto.productCategory ?? null,
      },
    });
    return { ok: true };
  }

  async createDistributorApplication(dto: CreateDistributorApplicationDto) {
    if (dto.website) return { ok: true };

    await this.prisma.distributorApplication.create({
      data: {
        companyName: dto.companyName,
        contactName: dto.contactName,
        email: dto.email,
        phone: dto.phone,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        zipcode: dto.zipcode,
        gstin: dto.gstin,
        experience: dto.experience ?? null,
        message: dto.message ?? null,
      },
    });
    return { ok: true };
  }

  async createSupportTicket(dto: CreateSupportTicketDto) {
    if (dto.botcheck) return { ok: true };

    await this.prisma.supportTicket.create({
      data: {
        contactName: dto.contactName,
        company: dto.company,
        phone: dto.phone,
        productType: dto.productType,
        category: dto.category,
        subject: dto.subject,
        email: dto.email?.trim() || null,
        invoice: dto.invoice || null,
        description: dto.description || null,
      },
    });
    return { ok: true };
  }

  async createSubscriber(email: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.subscriber.findUnique({ where: { email: normalized } });
    if (existing) {
      if (existing.hidden) {
        await this.prisma.subscriber.update({ where: { email: normalized }, data: { hidden: false } });
      }
      return { ok: true };
    }
    await this.prisma.subscriber.create({ data: { email: normalized } });
    return { ok: true };
  }

  /** Mail delivery failures must never fail the form submission — the lead is already saved. */
  private async sendBestEffort(to: string, subject: string, body: { html?: string; text?: string }) {
    try {
      await this.mail.send(to, subject, body);
    } catch (err) {
      this.logger.error(`Failed to send "${subject}" to ${to}`, err as Error);
    }
  }

  /** Every lead model shares id/hidden/createdAt, so one delegate lookup covers list + hide for all six. */
  private delegateFor(type: LeadType) {
    switch (type) {
      case 'contact':
        return this.prisma.contactLead;
      case 'quote':
        return this.prisma.quoteRequest;
      case 'enquiry':
        return this.prisma.enquiry;
      case 'distributor':
        return this.prisma.distributorApplication;
      case 'support':
        return this.prisma.supportTicket;
      case 'subscriber':
        return this.prisma.subscriber;
    }
  }

  async listLeads(type: LeadType, params: { page?: number; includeHidden?: boolean }) {
    const { page = 1, includeHidden = false } = params;
    const pageSize = 20;
    const delegate = this.delegateFor(type) as any;
    const where = includeHidden ? {} : { hidden: false };

    const [items, total] = await Promise.all([
      delegate.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      delegate.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async setLeadHidden(type: LeadType, id: string, hidden: boolean) {
    const delegate = this.delegateFor(type) as any;
    return delegate.update({ where: { id }, data: { hidden } });
  }
}
