import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Never leaks stack traces, Prisma query text, or file paths to the client
 * (checklist §3.3) — unexpected errors get a generic message + correlation
 * ID; full detail goes to the server log only. Known Prisma error codes are
 * mapped to sensible HTTP statuses so the client gets a useful response
 * rather than a blanket 500 for e.g. "record not found" or "unique conflict".
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : { statusCode: status, ...(body as object) });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        response.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found' });
        return;
      }
      if (exception.code === 'P2002') {
        response
          .status(HttpStatus.CONFLICT)
          .json({ statusCode: 409, message: 'A record with these unique details already exists' });
        return;
      }
    }

    const correlationId = randomUUID();
    this.logger.error(`[${correlationId}] Unhandled exception`, (exception as Error)?.stack);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
      correlationId,
    });
  }
}
