/**
 * Where uploaded files live (spec 0084): the files bucket
 * (nauticai-nemolink-files, docs/runbooks/AWS_SETUP_WALKTHROUGH.md — private,
 * SSE-S3, versioned) when FILES_BUCKET is set; otherwise the database row
 * (dev and until the bucket exists). The row always keeps the metadata and the
 * sha256; the store keeps the bytes. Keys are per organisation:
 * `org/<slug>/<area>/<uuid>.<ext>`.
 */
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StoredFile {
  storage: 's3' | 'db';
  /** The object key in the bucket; null for db storage. */
  storageKey: string | null;
  /** The bytes for the row; null when they went to the bucket. */
  content: Buffer | null;
}

@Injectable()
export class FileStore {
  private readonly logger = new Logger(FileStore.name);
  private readonly bucket: string | null;
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {
    this.bucket = (this.config.get<string>('FILES_BUCKET') ?? '').trim() || null;
  }

  get mode(): 's3' | 'db' {
    return this.bucket ? 's3' : 'db';
  }

  private s3(): S3Client {
    if (!this.client) {
      const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
      this.client = new S3Client({
        region: this.config.get<string>('AWS_REGION') ?? 'eu-west-1',
        // Explicit keys when given; otherwise the instance role (same rule as SES)
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      });
    }
    return this.client;
  }

  async put(orgSlug: string, area: string, ext: string, content: Buffer, contentType: string): Promise<StoredFile> {
    if (!this.bucket) return { storage: 'db', storageKey: null, content };
    const key = `org/${orgSlug}/${area}/${randomUUID()}.${ext}`;
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { storage: 's3', storageKey: key, content: null };
  }

  async get(file: { storage: 's3' | 'db'; storageKey: string | null; content: Buffer | null }): Promise<Buffer> {
    if (file.storage === 'db') {
      if (!file.content) throw new Error('The file has no bytes');
      return file.content;
    }
    if (!this.bucket || !file.storageKey) throw new Error('The files bucket is not configured');
    const out = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) throw new Error('The file is empty in the bucket');
    return Buffer.from(bytes);
  }

  /** Best effort: the row is deactivated either way; a versioned bucket keeps the old version. */
  async remove(file: { storage: 's3' | 'db'; storageKey: string | null }): Promise<void> {
    if (file.storage !== 's3' || !this.bucket || !file.storageKey) return;
    try {
      await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: file.storageKey }));
    } catch (e) {
      this.logger.warn(`files bucket delete ${file.storageKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
