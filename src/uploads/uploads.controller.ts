import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UploadsService } from './uploads.service';

const ALLOWED_MIME_TYPES = new Set(['application/pdf']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  // Used by Accounts to attach an external bill PDF on the Create Invoice screen.
  // Validated by actual MIME type (from multer's file-parsing, not just the
  // filename extension) and size — per security checklist §5.5.
  @Roles(UserRole.ACCOUNTS, UserRole.ADMIN)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only PDF files are allowed');
    }
    const url = await this.uploadsService.uploadFile(file);
    return { url };
  }
}
