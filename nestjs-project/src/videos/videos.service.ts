import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { Readable } from 'node:stream';
import type { JwtPayload } from '../auth/auth.types';
import {
  VideoNotFoundException,
  VideoNotOwnerException,
  VideoNotReadyException,
  VideoTooLargeException,
  VideoUploadNotFoundException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { PresignVideoPartDto } from './dto/presign-video-part.dto';
import {
  VIDEO_JOB_ATTEMPTS,
  VIDEO_JOB_BACKOFF_MS,
  VIDEO_JOB_NAME,
  VIDEO_MAX_SIZE_BYTES,
  VIDEO_PART_SIZE_BYTES,
  VIDEO_QUEUE_NAME,
} from './videos.constants';
import { Video } from './entities/video.entity';
import { VIDEO_STORAGE, type VideoStorage } from './storage.storage';

export interface VideoDraftPlan {
  id: string;
  publicKey: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  urls: Array<{ partNumber: number; url: string }>;
}

export interface VideoPlayback {
  body: Readable;
  statusCode: 200 | 206;
  contentLength: number;
  contentType: string;
  contentRange?: string;
  totalLength: number;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    @Inject(VIDEO_STORAGE)
    private readonly storage: VideoStorage,
    @InjectQueue(VIDEO_QUEUE_NAME)
    private readonly queue: Queue,
  ) {}

  async createDraft(
    user: JwtPayload,
    dto: CreateVideoDraftDto,
  ): Promise<VideoDraftPlan> {
    if (dto.size_bytes > VIDEO_MAX_SIZE_BYTES) {
      throw new VideoTooLargeException();
    }
    const channel = await this.channelRepository.findOneBy({
      id: dto.channel_id,
      user_id: user.sub,
    });
    if (!channel) throw new VideoNotOwnerException();

    const publicKey = randomBytes(24).toString('base64url');
    const sourceKey = `videos/${publicKey}/source`;
    const uploadId = await this.storage.createMultipartUpload(
      sourceKey,
      dto.mime_type,
    );
    const partCount = Math.ceil(dto.size_bytes / VIDEO_PART_SIZE_BYTES);
    const video = this.videoRepository.create({
      channel_id: channel.id,
      public_key: publicKey,
      title: dto.title,
      description: dto.description ?? '',
      source_key: sourceKey,
      upload_id: uploadId,
      size_bytes: String(dto.size_bytes),
      mime_type: dto.mime_type,
      status: 'DRAFT',
      metadata: {},
    });
    const saved = await this.videoRepository.save(video);
    const urls = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => ({
        partNumber: index + 1,
        url: await this.storage.presignUploadPart(
          sourceKey,
          uploadId,
          index + 1,
        ),
      })),
    );
    return {
      id: saved.id,
      publicKey: saved.public_key,
      uploadId,
      partSize: VIDEO_PART_SIZE_BYTES,
      partCount,
      urls,
    };
  }

  async presignPart(
    user: JwtPayload,
    videoId: string,
    dto: PresignVideoPartDto,
  ): Promise<{ partNumber: number; url: string }> {
    const video = await this.findOwned(videoId, user.sub);
    if (video.status !== 'DRAFT' || !video.upload_id) {
      throw new VideoUploadNotFoundException();
    }
    return {
      partNumber: dto.part_number,
      url: await this.storage.presignUploadPart(
        video.source_key,
        video.upload_id,
        dto.part_number,
      ),
    };
  }

  async completeUpload(
    user: JwtPayload,
    videoId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<{ id: string; status: string }> {
    const video = await this.findOwned(videoId, user.sub);
    if (video.status !== 'DRAFT') {
      return { id: video.id, status: video.status };
    }
    if (!video.upload_id) throw new VideoUploadNotFoundException();
    await this.storage.completeMultipartUpload(
      video.source_key,
      video.upload_id,
      dto.parts.map((part) => ({
        PartNumber: part.part_number,
        ETag: part.etag,
      })),
    );
    let head: { contentLength: number; contentType?: string };
    try {
      head = await this.storage.headObject(video.source_key);
    } catch {
      this.logger.warn(`Upload verification failed for video ${video.id}`);
      throw new VideoUploadNotFoundException();
    }
    if (head.contentLength !== Number(video.size_bytes)) {
      throw new VideoUploadNotFoundException();
    }
    const transition = await this.videoRepository.update(
      {
        id: video.id,
        status: 'DRAFT',
        upload_id: video.upload_id,
      },
      { status: 'PROCESSING', upload_id: null },
    );
    if (!transition.affected) {
      const current = await this.videoRepository.findOneBy({ id: video.id });
      if (!current) throw new VideoNotFoundException();
      return { id: current.id, status: current.status };
    }
    await this.queue.add(
      VIDEO_JOB_NAME,
      { videoId: video.id },
      {
        jobId: `video:${video.id}`,
        attempts: VIDEO_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: VIDEO_JOB_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(`Queued video ${video.id} as video:${video.id}`);
    return { id: video.id, status: 'PROCESSING' };
  }

  async getPublicPlayback(
    publicKey: string,
    range?: string,
  ): Promise<VideoPlayback> {
    const video = await this.videoRepository.findOneBy({
      public_key: publicKey,
    });
    if (!video) throw new VideoNotFoundException();
    if (video.status !== 'READY') throw new VideoNotReadyException();
    let totalLength: number;
    try {
      totalLength = Number(
        (await this.storage.headObject(video.source_key)).contentLength,
      );
    } catch {
      throw new VideoNotFoundException();
    }
    const normalizedRange = parseRange(range, totalLength);
    let object: Awaited<ReturnType<VideoStorage['getObject']>>;
    try {
      object = await this.storage.getObject(
        video.source_key,
        normalizedRange?.header,
      );
    } catch {
      throw new VideoNotFoundException();
    }
    return {
      body: object.body,
      statusCode: normalizedRange ? 206 : 200,
      contentLength: object.contentLength,
      contentType: video.mime_type,
      contentRange: normalizedRange?.contentRange ?? object.contentRange,
      totalLength,
    };
  }

  async getOwned(videoId: string, user: JwtPayload): Promise<Video> {
    return this.findOwned(videoId, user.sub);
  }

  private async findOwned(videoId: string, userId: string): Promise<Video> {
    const video = await this.videoRepository
      .createQueryBuilder('video')
      .innerJoin('video.channel', 'channel', 'channel.user_id = :userId', {
        userId,
      })
      .where('video.id = :videoId', { videoId })
      .getOne();
    if (!video) {
      const exists = await this.videoRepository.findOneBy({ id: videoId });
      if (!exists) throw new VideoNotFoundException();
      throw new VideoNotOwnerException();
    }
    return video;
  }
}

function parseRange(
  value: string | undefined,
  totalLength: number,
): { header: string; contentRange: string } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return undefined;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, totalLength - Number(match[2]));
  let end = match[2] ? Number(match[2]) : totalLength - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return undefined;
  }
  end = Math.min(end, totalLength - 1);
  if (start >= totalLength) return undefined;
  return {
    header: `bytes=${start}-${end}`,
    contentRange: `bytes ${start}-${end}/${totalLength}`,
  };
}
