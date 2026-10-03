import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LeadsService, LEAD_TYPES, type LeadType } from './leads.service';
import { CreateContactLeadDto } from './dto/create-contact-lead.dto';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { CreateDistributorApplicationDto } from './dto/create-distributor-application.dto';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

function assertLeadType(type: string): asserts type is LeadType {
  if (!(LEAD_TYPES as readonly string[]).includes(type)) {
    throw new NotFoundException(`Unknown lead type "${type}"`);
  }
}

// Public (no-auth) endpoints the RScompany marketing site's forms call
// directly. All six mirror the original Next.js API routes' 3-submissions/
// hour/IP cap (the site's "rateLimitContact" limiter) by overriding the
// 'default' throttler just for these routes — same pattern AuthController
// uses for its stricter login/OTP limits.
@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('contact')
  createContactLead(@Body() dto: CreateContactLeadDto) {
    return this.leadsService.createContactLead(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('quote')
  createQuoteRequest(@Body() dto: CreateQuoteRequestDto) {
    return this.leadsService.createQuoteRequest(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('enquiry')
  createEnquiry(@Body() dto: CreateEnquiryDto) {
    return this.leadsService.createEnquiry(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('distributor')
  createDistributorApplication(@Body() dto: CreateDistributorApplicationDto) {
    return this.leadsService.createDistributorApplication(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('subscribe')
  createSubscriber(@Body() dto: CreateSubscriberDto) {
    return this.leadsService.createSubscriber(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('support')
  createSupportTicket(@Body() dto: CreateSupportTicketDto) {
    return this.leadsService.createSupportTicket(dto);
  }

  // Admin-only read/moderate side, backing the OMS's Leads page.
  // :type is one of LEAD_TYPES — 'contact' | 'quote' | 'enquiry' | 'distributor' | 'support' | 'subscriber'.

  @Roles(UserRole.ADMIN)
  @Get(':type')
  list(@Param('type') type: string, @Query('page') page?: string, @Query('includeHidden') includeHidden?: string) {
    assertLeadType(type);
    return this.leadsService.listLeads(type, {
      page: page ? Number(page) : 1,
      includeHidden: includeHidden === 'true',
    });
  }

  @Roles(UserRole.ADMIN)
  @Patch(':type/:id')
  setHidden(@Param('type') type: string, @Param('id') id: string, @Body() body: { hidden: boolean }) {
    assertLeadType(type);
    return this.leadsService.setLeadHidden(type, id, body.hidden);
  }
}
