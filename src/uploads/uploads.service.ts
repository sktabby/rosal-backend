import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * Thin wrapper around any S3-compatible object storage. Works unmodified
 * against Cloudflare R2 or Backblaze B2 by swapping .env values — never
 * stores file bytes in Postgres.
 */
@Injectable()
export class UploadsService {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    this.publicBaseUrl = this.config.get<string>('S3_PUBLIC_BASE_URL')!;
    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION') ?? 'auto',
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder = 'external-attachments'): Promise<string> {
    const key = `${folder}/${randomUUID()}-${file.originalname}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        // Forces download/attachment rather than inline rendering when served
        // — prevents an uploaded file from executing inline in a browser
        // (checklist §5.5).
        ContentDisposition: 'attachment',
      }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }
}
