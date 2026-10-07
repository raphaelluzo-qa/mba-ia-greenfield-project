import type { Readable } from 'node:stream';

export const VIDEO_STORAGE = Symbol('VIDEO_STORAGE');

export interface StorageObject {
  body: Readable;
  contentLength: number;
  contentType?: string;
  contentRange?: string;
  etag?: string;
}

export interface VideoStorage {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
  ): Promise<void>;
  headObject(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }>;
  getObject(key: string, range?: string): Promise<StorageObject>;
  putObject(
    key: string,
    body: Readable | Uint8Array,
    contentType: string,
  ): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
